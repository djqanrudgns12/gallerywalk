# 성능 기록 (P6-4·P6-5)

> 예산은 ADR-057·AGENTS §4: 그리기 호출 휴대폰·태블릿 120·데스크톱 160, 보이는 삼각형 30만. 정지 상태에서는 다시 그리지 않는다.
> 실기기 수치(fps·GPU 메모리·발열)는 P6-5에서 사용자 기기로 잰다(U-05).

## 자동 시험 수치 (Playwright, 헤드리스 소프트웨어 그리기)

- 출처: `tests/e2e/student.spec.ts`가 첫 작품 정지 지점에서 멈춘 뒤 기록한다(`.local/perf/student-e2e.jsonl`).
- 실제 전시 경로(`/{입장 코드}`)이고, 합성 전시는 전시실 2·그림 6·글 1이다.
- 소프트웨어 그리기라 fps는 적지 않는다. 그리기 호출·삼각형만 기기와 상관없이 같은 장면의 값이다.

| 날짜 | 크기 | 자리 | 그리기 호출 | 삼각형 | 예산 |
|---|---|---|---|---|---|
| 2026-11-12 | 휴대폰 390×844 | 첫 작품 앞 | 62 | 81,435 | 120 / 300,000 |
| 2026-11-12 | 태블릿 820×1180 | 첫 작품 앞 | 62 | 81,455 | 120 / 300,000 |
| 2026-11-12 | 데스크톱 1440×900 | 첫 작품 앞 | 63 | 81,495 | 160 / 300,000 |

- 정지 상태 다시 그리기: 세 크기 모두 0이다. 멈춘 뒤 `IDLE_OBSERVATION_MS` 동안 그린 프레임 수가 그대로다(같은 시험).
- 다른 관람객 30명 예산(PRD 15.8)은 `tests/e2e/walk-dev.spec.ts`의 가짜 관람객 시험이 본다.

## 첫 받기 크기 (운영 빌드)

- 학생 첫 받기 JS(gzip) 약 143KB(2026-11-12 빌드). pdf.js·`@dnd-kit`·3D 미리 보기는 교사 화면에서만 지연 로드한다.

## 남은 것 (사용자 기기, U-05)

- iPad(학교 기종)·저가 안드로이드 태블릿·크롬북에서 걷기·크게 보기 fps와 품질 단계 자동 내림이 일어나는지
- 텍스처 MB(상주 관리 예산 `TEX_BUDGET_MB_*`)와 실제 GPU 메모리
- 30분 관람 뒤 메모리 증가(컨텍스트 손실·다시 붙이기 포함)

## F9 X1 · 첫 받기·동시 입장 기록 (2026-11-13)

| 항목 | 실행·대상 | 결과 | 받은 바이트·지연 | 근거·남은 확인 |
|---|---|---|---|---|
| V-31 · 21대 | `node --conditions=@gallery/source tools/load/admission.mjs --clients 21` · 개발 4521 · dry-run | 통과, `mode: dry-run`, `clients: 21`, `durationSeconds: 10` | 실측 미실행 | HTTP·방문자 등록·웹소켓 hello/위치·첫 관 미디어 단계 계획만 출력. 네트워크·파일 쓰기 없음 |
| V-31 · 30대 | `node --conditions=@gallery/source tools/load/admission.mjs --clients 30` · 개발 4521 · dry-run | 통과, `mode: dry-run`, `clients: 30`, `durationSeconds: 10` | 실측 미실행 | 같은 도구. 운영 4520·공개 주소·다른 앱 주소를 거절. 실제 21·30대 실행·학교망·CDN은 사용자 P7-3 |
| V-34 · 첫 받기 | `tests/e2e/prod.spec.ts` · 운영 웹 빌드 · 새 Chromium context | 구현·타입 검사·시험 탐색 통과. 빌드/e2e **미실행(75)** | 미측정, 6MB 통과 판정 없음 | `--wait-seconds 560` 유한 대기 1회 뒤 자원 입장 거절. HTTP 응답의 인코딩 본문+머리, SW 직접 수신, 입장까지 웹소켓 본문 합산. SW가 화면에 전달한 응답은 중복 제외. 입장 전 시작한 미완료 HTTP도 끝까지 포함하는 보수적 상계. SW 주 스크립트 요청 미관측 시 사전 읽은 동일 응답 크기를 더함 |
| V-30 · 운영 캐시 연결 확인 | 위 prod spec에 함께 작성 | 빌드/e2e **미실행(75)** | 미측정 | 같은 자원 입장 거절로 빌드·브라우저 모두 시작되지 않음. 시험 내용: 학생 입장·SW 제어 → 교사 메뉴의 전체 미리 받기 READY → 모든 관 필수 미디어/템플릿 캐시 확인 → 원래 탭 닫기 → offline 새 탭에서 포스터·첫 작품까지 이동·전체 필수 미디어 실제 읽기 |

| 검사·실행 규약 | 결과·기록 위치 |
|---|---|
| `node --conditions=@gallery/source --test tools/load/admission.test.mjs tests/e2e/support/receivedBytes.test.mjs` | 8개 통과. 구현 전 모듈 부재 실패 확인 뒤 구현. SW 중복 제외·미완료 요청·측정 실패·운영 대상 차단·오류 포함 p95·이번 기기 ID/위치 누락을 검사 |
| `npx tsc --noEmit -p tests/e2e/support/tsconfig.json` · `npx tsc -b` | 통과. e2e 자체도 별도 strict 타입 검사에 포함 |
| `GALLERY_PROD_E2E=1 npx playwright test tests/e2e/prod.spec.ts --project=prod --list` | 1파일 1시험 탐색 통과. 실제 브라우저 실행은 아님 |
| `node tools/check/index.mjs` · 변경 파일 `npx prettier --check` | 통과. 전체 verify는 통합 담당 phase 끝에 실행 |
| 운영 빌드 시험 명령 | `/Users/bodyking/.local/bin/resource-guard run --profile test --wait-seconds 560 -- node tests/e2e/support/run-prod.mjs`. 로컬 빌드 1회+prod spec 1회. 4521·4522가 사용 중이면 기존 서버를 재사용·종료하지 않고 중단. 별도 `.local/prod-e2e/` 합성 자료 사용 |
| 자동 기록·캡처 예정 경로 | `.local/perf/prod-first-receive.jsonl`, `.local/screens/prod/offline-poster.png`, `.local/screens/prod/offline-first-room.png`. 실제 e2e 성공 전까지 생성·화면 확인을 주장하지 않음 |
| 실제 부하 실행을 사용자가 진행할 때 | [도구 사용법](../tools/load/README.md). `.local/perf/admission-load.jsonl`에 단계별 p50/p95·오류율·수신량·이번 기기끼리 함께 관람한 수 기록. 토큰·별명·입장 코드는 기록하지 않음 |

## 동시 입장 부하 실측 (V-31, 2026-11-13, GitHub 호스트 macOS 러너)

- 실행: `.github/workflows/e2e.yml` `only: load`(실행 43406268753, 커밋 이 기록 직전). 러너 안에서 개발 서버(4521)와 부하 도구가 함께 돈다. 망 지연이 없으니 **서버 처리 능력**만 본 값이다. 합성 그림 21점 전시.
- 판정: 요청한 기기 전원이 HTTP 입장·방문자 등록·첫 관 미디어 받기·웹소켓 함께 관람(서로의 위치 받기)에 성공하고 오류 0 → **21대·30대 모두 통과**.

| 기기 | 단계 | p50 | p95 | 오류율 | 받은 바이트 |
|---|---|---|---|---|---|
| 21 | 입장(HTTP) | 175ms | 233ms | 0 | 1,946,595 |
| 21 | 방문자 등록 | 91ms | 195ms | 0 | 1,617 |
| 21 | 첫 관 미디어 | 17ms | 41ms | 0 | 8,524,530 |
| 21 | 웹소켓 함께 관람 | 170ms | 194ms | 0 | — |
| 30 | 입장(HTTP) | 183ms | 394ms | 0 | 2,780,850 |
| 30 | 방문자 등록 | 131ms | 345ms | 0 | 2,310 |
| 30 | 첫 관 미디어 | 17ms | 42ms | 0 | 12,177,900 |
| 30 | 웹소켓 함께 관람 | 90ms | 199ms | 0 | — |

- 남은 것(사용자, P7-3): 학교 와이파이에서 21대가 동시에 입장해 첫 관람까지 4초 안(PRD §10.1·§15.5). 망 대역·CDN·실기기 그리기 시간이 더해진다.
