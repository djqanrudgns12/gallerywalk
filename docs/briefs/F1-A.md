# F1-A · 교사 화면 MUST 빈칸(V-01·V-02·V-04) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 읽을 것
- AGENTS.md
- `docs/FINISH_PLAN.md` §3.1(V-01·V-02·V-04), §4 F1 세부, **§6 실행 규약 전부(꼭 지킴)**
- PRD G-09·G-10·G-01, 15.3-5·15.8
- PLAN §7.4

## 할 일(차례대로)
1. **V-01 글 붙여넣기**
   - 놓기 영역(`app/teacher/upload/DropZone.tsx`, 빈 상태 큰 영역과 얇은 띠 둘 다) 아래에 작은 `글 붙여넣기` 링크를 둔다.
   - 링크를 누르면 시트(`PasteSheet`)가 열린다: 제목(필수, 작품 제목 글자 수 한도), 본문(`TEXT_MAX_CHARS` 5,000자, 줄바꿈 유지). 지금 전시실 끝에 들어간다.
   - 저장하면 `text/plain` Blob(`{제목}.txt`)으로 **기존 올리기 줄**(`useUploads`·`uploadQueue`의 TEXT 경로)에 넣는다. 새 서버 경로는 만들지 않는다.
   - 시트는 한 번에 하나만 연다(PRD 9.6). 관리 화면 덮개 칸(`teacherStore` overlay)을 쓰거나, 쓰지 않으면 이유를 보고한다.
2. **V-02 포스터 이미지**
   - 새 전시 만들기 `더 설정하기`에 포스터 고르기(그림 파일 하나, 기기 사전 검사 재사용)를 둔다.
   - 관리 `···` 메뉴에 `포스터 바꾸기`·`포스터 빼기`를 둔다.
   - 기존 `api.teacher.uploadPoster`·`removePoster`를 쓴다.
   - 만들기 화면에서는 전시를 만든 직후 올린다(실패해도 전시는 만들어진 채로, 토스트 한 줄).
3. **V-04 선생님 캐릭터 고르기**
   - `ui/patterns/teacher/TeacherCharacterDialog`를 교사 첫 화면과 관리 `···` 메뉴에서 연다.
   - 고른 값은 `services.device.setTeacherCharacter()`(이미 있음, `ports/index.ts`의 `TeacherCharacter`)로 기억한다.
   - 이름표는 서버가 늘 "선생님"으로 정한다(`copy.live.teacher`). 대화 상자의 이름 칸은 읽기 전용으로 보이거나 숨긴다. 어느 쪽인지 보고한다.
   - `app/teacher/tour/TourScreen.tsx`의 `character="teacher-m"`을 `device.teacherCharacter()`로 바꾼다. **이 한 줄만** 고친다.

## 고칠 수 있는 파일
- `apps/web/src/app/teacher/upload/**`
- `apps/web/src/app/teacher/home/**`
- `apps/web/src/app/teacher/manage/ManageMenu.tsx`·`.test.tsx`·`ManageMenu.module.css`, 새 `manage/{PasteSheet,PosterSheet}*`
- `apps/web/src/app/teacher/manage/ManageExhibition.tsx`: `글 붙여넣기` 시트를 띄우는 연결 몇 줄만. 다른 줄은 Claude가 고치는 중이 아니지만 최소로 고친다.
- `apps/web/src/app/teacher/tour/TourScreen.tsx`: 위 한 줄
- `packages/core/src/copy/ko.ts`: `teacher` 묶음에 더하기만. 고치기 직전에 다시 읽고 작은 Edit로.
- 시험·시험 자료 `apps/web/src/dev/teacher*`, `tests/e2e/teacher.spec.ts`(새 단계만: 붙여넣기 한 번 → 격자에 글 카드)

## 건드리지 말 것
- `apps/web/src/app/visit/**`, `viewer/**`, `app/student/**`, `app/teacher/manage/PreviewLayer.tsx`(Claude 작업 중)
- `tools/dev/**`, `tests/e2e/student.spec.ts`·`support/exhibition.ts`(F1-B 작업 중)
- `packages/core/src/config.ts`(값이 필요하면 "설정값 후보"로 보고), `ports/index.ts`·`adapters/deviceStore.ts`(이미 끝남)
- 서버, `docs/**`, `.env*`, git, 새 의존성
- 맥미니 서비스, 운영 4520

## 끝 조건(§6.3 사다리)
- **L1**: 새 시험은 구현 전에 써서 실패를 본다(남의 파일 바꿔치기 금지).
  - 붙여넣기 시트: 제목 없음 막힘·5,000자 넘으면 막힘·저장 → 줄에 TEXT 작업 하나
  - 포스터 고르기·빼기 호출
  - 캐릭터 대화 상자 → 기기 기억 → 투어에 쓰임
- **L2**: `npx vitest run --project web apps/web/src/app/teacher`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx prettier --check <바꾼 파일들>`, `node tools/check/index.mjs`
- **L3 한 번**: `/Users/bodyking/.local/bin/resource-guard run --profile test --wait-seconds 560 -- npx playwright test tests/e2e/teacher.spec.ts -g "데스크톱" --workers=1`
  - 75면 최대 2회까지만 시도한다. 그래도 75면 미실행으로 적는다(§6.2).
- 넓은 검사(전체 vitest·전체 e2e·빌드)는 하지 않는다.

## 보고(한국어)
바꾼 파일, 실행한 검사(명령·결과 줄), 미실행과 까닭, 정한 해석, 설정값 후보, 고쳐야 할 것(범위 밖)
