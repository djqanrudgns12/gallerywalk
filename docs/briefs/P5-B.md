# P5-B · 전시 관리: 작품 격자·올리기·작품 패널·전시실 시트 (P5-3·P5-4·P5-5) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 목표
교사가 `/t/e/{id}`에서 작품을 올리고, 격자에서 고치고, 순서를 바꾸고, 전시실을 꾸리는 관리 화면을 운영 코드로 만든다.
- 뼈대(경로)는 Claude가 만들었다(`apps/web/src/app/teacher/TeacherApp.tsx`).
- 관리 화면 둘레 부품(열기 시트·`···` 메뉴·반응 탭)은 다른 서브에이전트(A)가 동시에 만든다. 이쪽은 그것을 `apps/web/src/app/teacher/manage/contract.ts`의 속성으로 붙이기만 한다. 자리 파일 `OpenSheet.tsx`·`ManageMenu.tsx`·`ReactionsTab.tsx`는 이미 있다.

## 읽을 것
- AGENTS.md(§2·§3·§5·§7)
- PLAN
  - §5 전부: 폴더 규칙·기기 사전 검사·PDF·판정기 — 교사 쪽 몫만
  - §7.2(`teacherStore`), §7.4(전시 관리·작품 탭 G-10~G-13·작품 패널 G-11·전시실 시트 G-12)
  - §9.2 교사 경로 표, §9.4·§10(올리기·처리 상태), ADR-032(끌어 옮기기 `@dnd-kit`)·ADR-055·ADR-056(PDF 3단계)
- PRD 6장·9.4·15.3·15.4
- 코드
  - `apps/web/src/ports/index.ts`(TeacherApi), `apps/web/src/adapters/api/{client.ts,http.ts}`: 파일 올리기 메서드가 아직 없다
  - 서버 `apps/server/src/http/routes/teacher.ts`(multipart 경로·응답 모양·한도), `apps/server/src/upload/**`
  - `packages/core/src/domain/{classify,pages}/**`(폴더 규칙·판정기·쪽 계획 — 이미 있음)
  - `apps/web/src/ui/patterns/teacher/{ArtworkCard,ArtworkGrid}.tsx`(R-7 부품)
  - `packages/core/src/copy/ko.ts`(`teacher` 묶음)
  - `apps/web/src/app/{services.ts,App.tsx}`

## 만들 것
1. **올리기 어댑터**(P5-3)
   - `TeacherApi`에 파일 보내기를 더한다(`ports/index.ts`·`adapters/api/client.ts`·`http.ts`):
     - 작품 그림·소리 multipart
     - 포스터·배경음악
     - PDF 3단계(만들기 → 쪽 PUT → complete, ADR-056)
   - 진행률(`XMLHttpRequest` upload progress 또는 `fetch` 스트림 — 브라우저 호환을 보고 고름)·취소·멱등 키(서버 규칙 그대로).
   - 시험은 `client.test.ts`에 더한다.
2. **관리 화면** `app/teacher/manage/ManageExhibition.tsx`
   - 불러오기(`exhibition`)·`teacherStore`(Zustand, §7.2), `rev` 충돌(`E_CONFLICT`)이면 새로 불러오기
   - 위: 전시 이름(눌러서 고침)·상태 점·"{날짜}에 지워져요"·`···`(A의 `ManageMenu`)·전시실 칩 줄(끌어서 순서, 끝에 `+`)
   - 점검 줄(제목 없음·흐림 수 → 누르면 해당 카드)
   - 탭: 작품 / 반응(A의 `ReactionsTab`)
   - 주요 버튼: 작품이 없으면 `작품 올리기`, 게시 1개 이상이면 `전시 열기`(A의 `OpenSheet`)
3. **작품 격자**(P5-4, G-10)
   - R-7 `ArtworkCard`·`ArtworkGrid` 부품을 쓴다.
   - 카드 제목 바로 고치기(0.6초 뒤 자동 저장)
   - 끌어서 순서·전시실 칩 위로 끌어 옮기기
   - 여러 장 고르기 → 아래 띠 `숨기기`·`게시`·`전시실 옮기기`(`batchArtworks`)
   - 빈 상태: 큰 놓기 영역, 작품이 있으면 얇은 띠. 화면 어디에 놓아도 받는다.
   - **`@dnd-kit`은 새 의존성이라 넣지 않는다.** 포인터 이벤트로 최소 끌기를 만들거나, 키보드·단추로 순서를 바꾸는 길을 먼저 두고 필요한 패키지를 보고한다. Claude가 넣는다.
4. **올리기 흐름**(P5-3)
   - 파일·폴더 놓기 → 폴더 규칙(전시실 나눔)·기기 사전 검사(크기·형식·HEIC 등, PRD 6.3)
   - 동시 3개 올리기·진행률 → 처리 상태 확인 → 카드에 결과·오류 한 줄(`errorCopy` + 해결법)
   - 중복은 `E_DUPLICATE`.
   - PDF 쪽 그리기(pdf.js)는 새 의존성이다. 넣지 말고, PDF는 "아직 준비 중" 문구로 막은 뒤 필요한 패키지를 보고한다.
5. **작품 패널**(P5-5, G-11)
   - 데스크톱은 오른쪽 패널, 휴대폰은 아래 시트.
   - 제목 / 접힘(작가·설명·글 고치기 5,000자) / 펼칠 때만 자동값(전시실·형태·쪽 나눔·글 많음·대표작) / `숨기기`·`삭제`(토스트 `되살리기` 10초 → `restoreArtwork`)
   - 저장은 0.6초 뒤 자동이고, 실패하면 칸 옆에 다시 시도.
6. **전시실 시트**(P5-5, G-12)
   - 이름판(30자)·소개(200자)·배경음악(올리기·바꾸기·빼기·미리 듣기)
   - `이 전시실 지우기`(작품이 있으면 옮겨짐 확인)
7. **문구**: `teacher` 묶음에 더하기만 한다. 수치는 `config.ts`에 있는 것을 쓰고, 없으면 이름 붙인 상수로 두고 보고한다.
8. **모양**: CSS 모듈 + 토큰·테마 변수만 쓴다. 금지: 이모지, 기본 `<select>`, `backdrop-filter`. 터치 44px 이상, 덮개 하나, 세 크기 반응형(1280↑ 격자 + 패널, 768~1279 격자, 767↓ 2열 + 아래 시트).

## 고칠 수 있는 파일
- `apps/web/src/app/teacher/manage/**` — `OpenSheet`·`ManageMenu`·`ReactionsTab`·`QrCode`·`contract.ts`는 빼고(A, Claude). 이 네 부품은 가져와 붙이기만 한다.
- `apps/web/src/app/teacher/upload/**`(새 폴더)
- `apps/web/src/ports/index.ts`(TeacherApi에 올리기 메서드 더하기만), `apps/web/src/adapters/api/**`
- `packages/core/src/copy/ko.ts`(`teacher` 묶음에 더하기만)
- 시험(`*.test.ts(x)`), 시험 자료 `apps/web/src/dev/**`

## 건드리지 말 것
- `apps/web/src/app/teacher/{home,shared}/**`(A — `shared`의 부품은 가져다 써도 됨), `TeacherApp.tsx`
- `apps/web/src/app/{visit,visit2d,student,reactions}/**`, `apps/web/src/{viewer,ui}/**`(부품이 모자라면 보고)
- `apps/server/**`(서버가 모자라면 보고), `packages/core/src/**`(ko.ts 말고), `docs/**`, `tests/e2e/**`
- `.env*`, git, 새 의존성, 맥미니 서비스

## 끝 조건
1. 단위 시험(jsdom, 가짜 api)
   - 올리기: 동시 3개 · 진행률 · 사전 검사 거절 문구 · 중복 · 처리 상태 확인
   - 격자: 바로 고치기 자동 저장 · 순서 바꾸기 · 여러 장 띠
   - 패널: 저장 실패 다시 시도 · 삭제 → 되살리기 10초
   - 전시실 시트: 지우기 확인
   - `E_CONFLICT` 새로 불러오기
   - 어댑터의 multipart·진행률 시험
   - 새 시험은 고치기 전 코드에서 실패하는지 본다.
2. `npx vitest run --project web apps/web/src/app/teacher apps/web/src/adapters`, `npx tsc -b`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx prettier --check apps/web/src packages/core/src/copy`, `node tools/check/index.mjs`, `node --test tools/check/check.test.mjs`가 통과한다.
3. 실제 개발 서버 확인
   - 시드 도구 `node tools/dev/seed-exhibition.mjs --save`로 전시를 하나 만든다. 교사 토큰은 `.local/dev/seed/`에만 있고 보고·캡처에 넣지 않는다.
   - 그 토큰을 기기 저장에 넣어 `/t/e/{id}`를 연다. 합성 그림 2장을 올리고, 제목을 고치고, 순서를 바꾼다.
   - 세 크기(390·820·1440)로 캡처해 `.local/p5-b/`에 둔다.
   - 헤드리스 실행은 `resource-guard run --profile test --wait-seconds 600`으로 감싸 포그라운드로 돌린다.

## 보고(한국어)
- 바꾼 파일, 명령과 출력 끝 20줄, 캡처 경로
- 정한 해석, 넣어야 할 의존성(`@dnd-kit`·pdf.js 등)·설정값, A와 맞춰야 할 것, 서버에서 고칠 것, 미실행
