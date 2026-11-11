# P4-seed · 개발 서버 시험 전시 채우기 도구 — 맡는 곳: Codex (standard)

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 목표
학생 관람 화면(P4-2)과 학생 e2e(P4-12)를 실제 서버 자료로 확인하려면, 개발 서버(127.0.0.1:4521)에 **열린(OPEN) 전시**가 있어야 한다. 지금은 채우는 도구가 없다. 교사 HTTP 경로만으로 합성 그림 전시를 만들고 여는 개발 도구를 만든다.

## 읽을 것
- AGENTS.md(§2·§3·§5·§6)
- PLAN §9.2(교사 경로 표)·§10.3(미디어)·§11(토큰·PIN)
- 서버 코드:
  - `apps/server/src/http/routes/teacher.ts`
  - `apps/server/src/upload/**`
  - `apps/server/scripts/dev.mjs`: 개발에서는 `START_CODE_REQUIRED=false`, 개발 비밀은 고정 이름표의 해시
- 웹 어댑터 `apps/web/src/adapters/api/client.ts`: 토큰을 보내기 전에 만들고 해시만 보낸다
- `packages/core/src/types/{exhibition,artwork,room}.ts`

## 만들 것
- `tools/dev/seed-exhibition.mjs`(새 폴더 `tools/dev/`). 실행 예: `node tools/dev/seed-exhibition.mjs --rooms 3 --per-room 6 --text 1 --title "시험 근대 역사관"`.
  1. 대상은 `http://127.0.0.1:4521`만 받는다. 다른 호스트·포트는 거절한다(운영 4520 보호).
  2. 전시 만들기(`POST /api/teacher/exhibitions`, 새 UUID·무작위 PIN·링크 토큰 해시) → 전시실 만들기 → 그림 작품 올리기(multipart) → 처리 끝까지 기다리기 → 게시 → 전시 열기(`/open`).
  3. 그림은 `sharp`로 그 자리에서 만든다. 1600px 이상이고 가로·세로·정사각 비율을 섞는다. 색면·도형·가상 제목 글씨처럼 합성 그림만 쓰고, 실제 작품·이름은 쓰지 않는다.
  4. 글 작품(`--text n`)은 JSON 경로로 만든다. 가상 글만 쓴다.
  5. 끝나면 표준 출력에 JSON 한 줄을 낸다: `{ exhibitionId, entryCode, teacherToken, pin, artworks: n }`.
     - 토큰·PIN은 개발 DB 전용 값이다. 파일로 남기려면 `.local/dev/seed/<entryCode>.json`(git 제외)에만 둔다.
  6. 같은 명령을 다시 돌리면 새 전시를 하나 더 만든다(멱등일 필요 없음). 실패하면 어느 단계인지와 서버 오류 코드를 적고 끝 코드 1로 끝낸다.
- 도구 시험: `tools/dev/seed-exhibition.test.mjs`(`node --test`)
  - 합성 그림 크기·비율 만들기
  - 대상 주소 검사(4521만 통과)
  - 단계 순서: 가짜 `fetch`로 경로·메서드 순서를 확인한다
  - 새 시험은 고치기 전 코드에서 실패하는지 본다.

## 건드리지 말 것
- `apps/**`, `packages/**`, `docs/**`, `tests/e2e/**`
- `.env*`, git, 새 의존성(`sharp`는 서버에 이미 있음. 루트에서 못 찾으면 보고), 운영 4520, 맥미니 서비스
- 개발 서버 4521이 떠 있지 않으면 `npm run dev -w @gallery/server`를 백그라운드로 띄워도 된다. 떠 있으면 그대로 쓰고 끄지 않는다.

## 끝 조건
1. `node --test tools/dev/seed-exhibition.test.mjs`가 통과한다.
2. 실제로 한 번 돌려 OPEN 전시가 생긴다. 그 입장 코드로 `curl -s http://127.0.0.1:4521/api/e/<code>`이 `data.artworks` n개와 `data.layout`을 돌려주는지 확인한다(응답 앞부분만 보고에 적고 토큰은 적지 않는다).
3. `npx prettier --check tools/dev`와 `node tools/check/index.mjs`가 통과한다.

## 보고(한국어)
바꾼 파일, 명령과 출력 끝 20줄(토큰·PIN 가림), 만든 전시의 입장 코드, 정한 해석, 미실행
