# 운영 안내서 (맥미니 배포·자동 배포)

> ADR-060, PLAN §19. 모든 명령은 **소유자 계정 터미널**에서 저장소 폴더(`gallerywalk`)에서 실행한다.
> 실제 일은 서비스 계정 `gwsvc`가 한다. 관리자 비밀번호(sudo)는 ①·③ 두 번만 묻는다.

## 한눈에

```
git push (main) ─▶ GitHub CI(verify, macOS) ─▶ 맥미니 launchd 1분마다 확인(pull)
                                                   │ CI 성공 + 수업 시간 아님 + 맥미니 한가함
                                                   ▼
                     releases/<sha> 빌드 → 운영 DB 사본으로 사전 기동 → 링크 교체 → 재시작 → 건강 확인
                                                   │ 실패
                                                   ▼
                                          이전 릴리스로 되돌림
```

- 서버 폴더: `/Users/gwsvc/gallery-server/{app→releases/<sha>, releases, data, media, tmp, secrets, logs, state, repo-cache, bootstrap}`
- 운영 포트 `127.0.0.1:4520`, 사전 검사 `4523`, 터널 메트릭 `20243`
- 평일 08:00~16:00(KST)에는 배포하지 않는다. 그 시간에 푸시하면 16시 뒤 첫 회차(1분 안)에 올라간다.

## 처음 한 번 (순서대로)

### ① 호스트 준비 — 언제든 (sudo)

```bash
sh ops/gw.sh setup-host
```

`gwsvc` 계정(비관리자·숨김), `/etc/sudoers.d/gallerywalk`(소유자 → gwsvc만), 서버 폴더(700), Time Machine 제외, 로그 회전, 운영 비밀값 3개를 만든다. 다시 실행해도 기존 데이터·비밀값은 그대로다.

### ② 첫 배포 — 평일 16시 이후 또는 주말

```bash
sh ops/gw.sh deploy --init
```

GitHub `main` 최신 커밋을 받아 빌드하고 사전 기동 검사까지 한다(몇 분). 맥미니가 바쁘거나 수업 시간이면 `75`로 끝난다. 실패가 아니니 나중에 다시 실행한다.

### ③ 데몬 등록 (sudo)

```bash
sh ops/gw.sh install-daemons server autodeploy
```

```bash
sh ops/gw.sh status
```

`건강 … → 200`이면 서버가 뜬 것이다. 이때부터 `main`에 푸시하면 자동으로 배포된다.

### ③-1 전시 만들기 시작 코드 (꼭)

```bash
sh ops/gw.sh start-code
```

숫자 6~32자리를 화면에 보이지 않게 두 번 입력한다. 서버는 원문이 아니라 HMAC만 `meta.start_code_hmac`에 둔다(ADR-048). 이것이 없으면 운영에서는 **누구도 전시를 만들 수 없다**(처음 쓰는 기기가 코드를 물어도 맞는 값이 없음). 서버 재시작은 필요 없다. 확인: `sh ops/gw.sh start-code --status`. 코드를 바꿔도 이미 맞힌 기기는 계속 묻지 않는다.

### ④ 바깥에 열기 (2026-11-13 실제로 한 순서)

```
학생 → gallery.ssamuniverse.com(회색 구름) → CloudFront 글방 배포 E3TFCRGRU1HG1Q(서울)
     → origin-gallery.ssamuniverse.com(주황 구름) → Cloudflare WAF gw-origin-lock → 터널 gallerywalk → 127.0.0.1:4520
```

순서를 지킨다. WAF 규칙보다 원본 DNS를 먼저 붙이면 CloudFront를 거치지 않는 뒷문이 열린다.

1. `sh ops/gw.sh origin-secret` — 원본 잠금 값(64자)을 `~/.gallerywalk-admin/`(600)에 만들고 클립보드로만 건넨다. 서버는 이 값을 몰라도 된다.
2. `sh ops/gw.sh tunnel-create` — 터널 `gallerywalk`를 만들고 자격 증명을 gwsvc로 옮긴다.
3. Cloudflare(`ssamuniverse.com`) 사용자 지정 규칙 `gw-origin-lock`(Block):
   `(http.host eq "origin-gallery.ssamuniverse.com" and not any(http.request.headers["x-gw-origin-auth"][*] eq "<값>"))`,
   Cache Rule `gw-origin-no-cache`(호스트 = origin-gallery → 캐시 우회).
4. `sh ops/gw.sh install-daemons tunnel` (sudo)
5. 원본 DNS는 **대시보드에서** 만든다: `ssamuniverse.com`에 CNAME `origin-gallery` → `<터널ID>.cfargotunnel.com`, **주황 구름(필수 — 터널은 프록시로만 들어감, WAF도 그때만 걸림)**.
   `cloudflared tunnel route dns`는 쓰지 않는다 — 소유자의 `~/.cloudflared/cert.pem`이 `rollinthunder.net` 영역으로 로그인돼 있어 레코드가 엉뚱한 영역에 생긴다(실제로 생겨서 지웠다).
   확인: 비밀 머리 없음·틀림 → 403, 맞음 → 200. 이 맥은 옛 DNS 조회가 남아 있을 수 있어 `curl --resolve`로 1.1.1.1의 답을 고정해 본다.
6. 인증서(us-east-1 ACM): 배포 하나는 인증서를 하나만 쓴다. `write`+`gallery`를 함께 담은 인증서를 DNS 검증으로 받는다(`gallery` 검증 CNAME은 회색 구름).
7. CloudFront 글방 배포 `E3TFCRGRU1HG1Q` 한 번에 바꾸기: 원본 `origin-gallery`(HTTPS 전용, 머리 `x-gw-origin-auth`) 추가, 대체 도메인 `gallery.ssamuniverse.com` 추가, 인증서 교체, 세 동작(`*`·`/assets/*`·`/art/*`)의 함수를 `ssam-viewer-request`(= `ops/cloudfront/viewer-request.js`, 먼저 test-function으로 확인 뒤 LIVE 게시)로 교체.
   바꾸기 전 설정은 `~/.gallerywalk-admin/backup/`·`rollback-config.json`(600, 글방 원본 비밀값이 들어 있어 화면에 내지 않음).
   `--if-match`는 실행 순간 `get-distribution-config`로 받은 ETag를 쓴다.
8. Cloudflare DNS: CNAME `gallery` → `d2gtrsnqpjb6in.cloudfront.net`, **회색 구름(필수 — 켜면 CDN 두 겹)**.

되돌리기(글방을 원래대로): `rollback-config.json`으로 `update-distribution`, `gallery` CNAME 삭제. 함수 `we-viewer-request`는 지우지 않고 남겨 둔다.

### ⑤ 감시·알림 (ADR-066)

1. 맥미니 쪽(언제든, sudo): `sh ops/gw.sh install-daemons watch` — 1분마다 로컬·공개·뒷문을 점검해 `logs/watch.log`와 `sh ops/gw.sh status`의 "하트비트"에 남긴다.
2. AWS 쪽(사용자 로그인·승인 필요): `aws login --profile we` 뒤

   ```bash
   sh ops/aws/setup-alerts.sh --email <받을 메일> --dry-run
   ```

   로 할 일을 본 다음 `--dry-run`을 빼고 실행한다. IAM 사용자 `gw-macmini`(지표 쓰기 전용, 이름 공간 `Gallerywalk`만) → 접근 키를 gwsvc `secrets/aws-macmini-credentials`(600)에 바로 넣음(화면에 안 나옴) → 알림 주제 `gw-alerts` + 메일 구독(확인 링크 눌러야 함) → 알람 `gw-heartbeat-missing`(1분 × 3회, 신호 없음도 알림). 글방 알림 주제를 함께 쓰려면 `--email` 대신 `--topic-arn <ARN>`. 그 뒤로는 맥미니가 꺼져도 3분 안에 메일이 온다.
3. 서버 파일 권한(umask 077)은 서버 데몬을 다시 설치할 때 반영된다(서버 재시작 — 평일 16시 뒤): `sh ops/gw.sh install-daemons server`

## 평소

| 하고 싶은 것 | 명령 |
|---|---|
| 상태 보기 | `sh ops/gw.sh status` |
| 자동 배포 상태·대기 이유 | `sh ops/gw.sh autodeploy status` |
| 다음에 올라갈 커밋 미리 보기 | `sh ops/gw.sh autodeploy dry-run` |
| 잠시 멈춤 / 다시 켬 | `sh ops/gw.sh autodeploy pause` / `resume` |
| 기록 보기 | `sh ops/gw.sh logs server` (`autodeploy`·`tunnel`) |
| 손으로 배포(특정 커밋) | `sh ops/gw.sh deploy <40자 SHA>` |
| 이전 릴리스로 되돌리기 | `sh ops/gw.sh rollback` (자동 배포는 멈춤) |

자동 배포 상태 문구:

- `수업 시간 — 16:00 뒤 배포`: 기다리는 중
- `CI 기다리는 중`: GitHub CI가 아직 안 끝남
- `배포 대기(맥미니가 바쁩니다 …)`: 부하가 내려가면 다음 회차에
- `실패 1회`: 다음 회차에 한 번 더
- `중단: … 실패 2회` / `CI verify: failure`: 고친 커밋을 푸시하면 그 커밋으로 다시 시작. 같은 커밋을 다시 하려면 `autodeploy retry`

## 배포 실패

- **빌드·사전 검사 실패**: 운영은 그대로다. `~gwsvc/gallery-server/logs/build-<sha>.log`·`deploy-<sha>.log` → 고쳐서 푸시.
- **재시작 뒤 건강 확인 실패, 스키마 같음**: 이전 릴리스로 자동으로 되돌린다.
- **재시작 뒤 건강 확인 실패, 스키마 바뀜**: 지금 서버는 DB가 더 새 판이면 이전 코드로 시작하지 않는다(ADR-060). 자동 배포가 멈추고 서버는 실패 상태일 수 있다. 서버 기록(`data/logs/gallery-*.log`)을 보고 고친 커밋을 `sh ops/gw.sh deploy <SHA>`로 올린 뒤 `autodeploy resume`.

## 하지 않는 것

- 다른 앱(쌤유니버스 `clsvc`, rollingthunder `rtsvc`, 글방 `wesvc`)의 계정·포트·데몬 건드리기
- 백업(30일 삭제 약속, ADR-003). `gallery-server` 전체가 Time Machine에서 빠져 있다.
- 맥미니에 GitHub self-hosted 러너 두기
