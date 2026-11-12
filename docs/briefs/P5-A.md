# P5-A · 선생님 첫 화면·PIN·링크·새 전시·열기 시트·`···` 메뉴·반응 탭 (P5-1·P5-2·P5-7·P5-8) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 목표
교사 화면의 앞부분과 관리 화면의 둘레 부품을 운영 코드로 만든다. 뼈대(경로)는 Claude가 만들었다(`apps/web/src/app/teacher/TeacherApp.tsx`). 관리 화면 본체(격자·올리기·패널)는 다른 서브에이전트(B)가 동시에 만든다. B는 이쪽 부품을 `apps/web/src/app/teacher/manage/contract.ts`의 속성으로만 붙인다.

## 읽을 것
- AGENTS.md(§2·§3·§5·§7)
- PLAN
  - §7.1(교사 경로·`/t#{토큰}` — 조각을 지움), §7.2(`teacherStore`), §7.4 전부(첫 화면·새 전시 G-09·열기 시트 G-14·반응 탭 G-15·`···` 메뉴), §7.5·§7.6
  - §9.2 교사 경로 표, §11.1(링크 토큰·PIN·시작 코드)
  - ADR-024(PIN)·ADR-044(링크 조각)·ADR-046(투어 시간)·ADR-048(시작 코드)
- PRD 9.4·15.4(교사 완료 기준)
- 코드
  - `apps/web/src/ports/index.ts`(TeacherApi·DeviceStore — `recentExhibitions`·`teacherSession`·`startCodePassed`)
  - `apps/web/src/adapters/api/client.ts`
  - `apps/web/src/app/{services.ts,App.tsx,routes.ts}`
  - 학생 쪽 숫자 칸 참고 `apps/web/src/app/student/HomeScreen.tsx`
  - `apps/web/src/ui/patterns/teacher/**`, `apps/web/src/ui/{tokens.css,themes/*.css,Icon.tsx}`
  - `packages/core/src/copy/ko.ts`(`teacher` 묶음), `packages/core/src/config.ts`, `packages/core/src/types/exhibition.ts`·`reaction.ts`
  - 서버 `apps/server/src/http/routes/teacher.ts`(실제 응답·오류)
- 제약: 최근 전시 목록에는 학생이 본 전시도 들어간다(ADR-059). 첫 화면에는 이 기기에 교사 토큰(`teacherSession`)이 있는 것만 보인다.

## 만들 것
1. **첫 화면** `app/teacher/home/TeacherHome.tsx`(P5-1)
   - 최근 전시 카드(최대 5): 썸네일이 없으면 이름판, 이름, 상태 점, "{날짜}에 지워져요". 누르면 `/t/e/{id}`.
   - `PIN으로 들어가기`: 숫자 키패드 시트(6~8자리) → `pinLogin` → 관리 화면. 실패는 `E_PIN_INVALID`·`E_PIN_LOCKED`({n}분) 문구.
   - 주요 버튼 `새 전시 만들기`.
   - 기억한 전시가 없으면 안내 한 줄.
   - `/t#{토큰}`: 토큰 형식 확인 → `openLink` → 조각 지우기(`history.replaceState`) → `/t/e/{id}`. 실패하면 "다시 들어와 주세요".
2. **새 전시 만들기** `app/teacher/home/NewExhibition.tsx`(P5-2, G-09)
   - 보이는 것 4가지: 전시 이름(필수 40자), 템플릿 카드(지금은 `modern-history` 하나 + 준비 중 딱지 카드), 한 줄 소개(60자), PIN(6~8자리 숫자 키패드).
   - 접힌 `더 설정하기`: 학교·학급 표시, 반응 설정(PRD G-07 표), 자동 투어 시간(`노래 길이에 맞춤`/`전시실마다 ○초`).
   - 포스터 이미지는 파일 올리기가 필요하다. B가 만드는 올리기 길이 생기기 전까지는 관리 화면에서 고르게 미룬다(보고에 적기).
   - 시작 코드(ADR-048): 이 기기가 아직 통과하지 않았으면 PIN 아래 한 칸을 더 보인다.
   - `전시 만들기` → `/t/e/{id}` + 토스트 "이 전시는 오늘부터 30일 동안 열 수 있어요"(`copy`에 없으면 더한다).
   - 오류: `E_PIN_TAKEN`·`E_PIN_WEAK`·`E_START_CODE`·`E_VALIDATION`은 칸 아래에 둔다.
3. **열기 시트** `app/teacher/manage/OpenSheet.tsx`(P5-7, G-14) — 속성은 `contract.ts`의 `OpenSheetProps`.
   - 반응 설정 한 줄 요약 + `바꾸기`(설정 고치기는 `patchExhibition`).
   - `열기` → `changeStatus('open')`. 게시 0이면 "게시한 작품이 있어야 열 수 있어요".
   - 연 뒤: QR · 짧은 주소 · 입장 코드 · `QR 크게 띄우기`(전체 화면에 주소·코드도 크게).
   - **QR 생성 라이브러리는 새 의존성이라 넣지 않는다.** QR 자리는 `QrCode` 부품 하나로 떼어 두고(지금은 코드·주소 글자만), 필요한 패키지를 보고한다. Claude가 넣는다.
4. **`···` 메뉴** `app/teacher/manage/ManageMenu.tsx`(P5-7) — 속성은 `ManageMenuProps`.
   - 항목: 자동 투어(`/t/e/{id}/tour`), 선생님 링크 복사(이 기기에 링크가 있을 때만, 경고 문구), 링크 새로 만들기(`rotateLink`), 전시 닫기·다시 열기(`changeStatus`), 지금 삭제(확인 시트 + 3초 뒤 눌리는 버튼, G-18 → `deleteExhibition` → `onDeleted`).
   - 수업 전 미리 불러오기(P5-10)는 메뉴 항목 자리만 두고 비활성으로 둔다(보고).
5. **반응 탭** `app/teacher/manage/ReactionsTab.tsx`(P5-8, G-15) — 속성은 `ReactionsTabProps`.
   - 작품별 한 줄: 스티커별 수·메모 수·평가 평균.
   - 누르면 메모 목록: 별명 또는 `익명`·시각, 메모마다 `숨기기`, 공개가 '고른 것만'일 때 `모두에게 보이기`(`patchReaction`).
   - 주요 버튼 `내려받기`: `reactionsCsv` → Blob 내려받기(`a[download]`).
6. **문구**: `packages/core/src/copy/ko.ts`의 `teacher` 묶음에 더하기만 한다(있는 키는 고치지 않음). 교사 화면은 기술 낱말 규칙이 학생보다 느슨하다.
7. **모양**: CSS 모듈 + 토큰·테마 변수만 쓴다. 금지: 이모지, 기본 `<select>`, `backdrop-filter`, 그라데이션. 터치 44px 이상, 덮개는 한 번에 하나, 세 크기 반응형(1280↑·768~1279·767↓).

## 고칠 수 있는 파일
- `apps/web/src/app/teacher/home/**`
- `apps/web/src/app/teacher/manage/{OpenSheet,ManageMenu,ReactionsTab,QrCode}*`, `apps/web/src/app/teacher/shared/**`(새 폴더, 키패드 등 함께 쓰는 것 — B도 쓸 수 있게)
- `packages/core/src/copy/ko.ts`(`teacher` 묶음에 더하기만)
- 시험: 위 폴더의 `*.test.ts(x)`, 시험 자료는 `apps/web/src/dev/**`

## 건드리지 말 것
- `apps/web/src/app/teacher/manage/`의 다른 파일(B), `TeacherApp.tsx`·`manage/contract.ts`(약속을 바꿔야 하면 보고)
- `apps/web/src/app/{visit,visit2d,student,reactions}/**`, `apps/web/src/{viewer,ui,adapters,ports}/**`(모자라면 보고)
- `apps/server/**`, `packages/core/src/**`(ko.ts 말고), `docs/**`, `tests/e2e/**`
- `.env*`, git, 새 의존성, 맥미니 서비스

## 끝 조건
1. 단위 시험(jsdom, 가짜 api·가짜 기기 저장)
   - 첫 화면: 교사 토큰 있는 전시만 · 지난 전시 빠짐 · PIN 성공·실패·잠김 · `/t#토큰` 처리 · 조각 지움
   - 새 전시: 필수·글자 수 · 시작 코드 칸 보이기/숨기기 · 오류 칸 · 성공 이동
   - 열기 시트: 게시 0 잠김 · 열기 → QR 자리·코드 · 크게 띄우기
   - 메뉴: 링크 있을 때만 복사 · 삭제 3초 잠금 · 닫기/다시 열기
   - 반응 탭: 집계 · 메모 숨기기 · CSV 내려받기 호출
   - 새 시험은 고치기 전 코드에서 실패하는지 본다.
2. `npx vitest run --project web apps/web/src/app/teacher`, `npx tsc -b`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx prettier --check apps/web/src packages/core/src/copy`, `node tools/check/index.mjs`, `node --test tools/check/check.test.mjs`가 통과한다.
3. 캡처: 실제 개발 서버(4521·4522)에서 `/t` → 새 전시 만들기 → 관리 화면(자리) → `···` 메뉴, 첫 화면 PIN 시트를 세 크기(390·820·1440)로 찍는다.
   - scratchpad의 Playwright 스크립트를 쓰고, `resource-guard run --profile test --wait-seconds 600`으로 감싸 포그라운드로 돌린다.
   - 캡처는 `.local/p5-a/`에 둔다. 개발 서버에는 시작 코드가 꺼져 있다.

## 보고(한국어)
- 바꾼 파일, 명령과 출력 끝 20줄, 캡처 경로
- 정한 해석, 넣어야 할 의존성(QR 등)·설정값, B와 맞춰야 할 것, 모자란 포트·부품, 미실행
