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

### ④ 바깥에 열기 — P7-2에서 함께 (콘솔 작업)

아직 바깥 주소는 없다(맥미니 안에서만 열림). 열 때는 이 순서를 지킨다. WAF 규칙보다 DNS를 먼저 붙이면 원본이 그대로 드러난다.

1. Cloudflare 로그인이 안 되어 있으면 `cloudflared tunnel login`(브라우저에서 `ssamuniverse.com` 선택).
2. `sh ops/gw.sh tunnel-create` — 터널 `gallerywalk`를 만들고 자격 증명을 gwsvc로 옮긴다.
3. Cloudflare WAF: `origin-gallery.ssamuniverse.com`에 원본 비밀 머리가 없으면 403(글방·쌤유니버스와 같은 방식).
4. `sh ops/gw.sh install-daemons tunnel`
5. `cloudflared tunnel route dns gallerywalk origin-gallery.ssamuniverse.com`
6. CloudFront 공용 입구(ADR-002, U-01): 글방 배포에 대체 도메인·원본·함수(`ops/cloudfront/viewer-request.js`) 반영, Cloudflare DNS `gallery` CNAME.

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
