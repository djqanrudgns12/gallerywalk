# F8-A · 첫 화면·포스터 다시 그리기(V-52·V-53) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk
**모든 출력(보고·진행 문장·커밋 메시지 없음)은 한국어로 쓴다.**

## 배경
사용자 평가는 "학생 화면이 촌스럽고 AI 느낌이며 조잡하다"였다. 그래서 방향 A **"어두운 전시관 안내 체계"**로 다시 그린다(기본안, U-24).
- 시안 파일(정적 HTML, 읽기만): `/private/tmp/claude-501/-Users-bodyking-Desktop-Architecture-gallerywalk/5c52a56e-7aa0-40a4-8679-f3a018ed8deb/scratchpad/design-v50/project/Main.dc.html`
  - 왼쪽 = 첫 화면, 가운데 = 포스터
- 토큰은 이미 새로 만들었다: `apps/web/src/ui/themes/gallery-dark.css`(숯색 판·상아 글자·놋쇠 강조 `--accent`, 각진 모서리). 학생 화면 `data-theme`은 `gallery-dark`다.
- 글꼴: 제목 `--font-display`(Hahmlet 600·700), 본문 `--font-ui`(Pretendard).

## 원칙(시안 A)
- 카드 안의 카드, 얇은 금테 이중 테두리, 베이지 종이 바탕을 없앤다. 꽉 찬 숯색 바탕 위에 여백과 큰 활자로 위계를 만든다.
- 한 화면에 강조색(놋쇠)은 주요 단추 하나와 작은 표시 몇 곳만 쓴다.
- 보조 회색 글은 꼭 필요한 한 줄만 둔다. 세리프 제목에 넓은 자간(`letter-spacing`)을 쓰지 않는다.
- 금지(PRD 9.6·AGENTS §3): 이모지, 그라데이션(UI), 유리(`backdrop-filter`), 순검정, 네온, 기본 `<select>`.
- 색·간격·모서리·글꼴은 토큰 변수만 쓴다.
- 누르기 크기 44px 이상, 대비 AA를 지킨다.

## 할 일
1. **V-52 첫 화면**(`app/student/HomeScreen.*`)
   - 꽉 찬 어두운 바탕을 쓰고, 위에 작은 앱 이름(놋쇠)을 둔다.
   - 제목은 큰 세리프 두 줄 "전시관에 / 들어가요"류로 쓴다. 문구는 `ko.ts`에 더한다.
   - 숫자 6칸은 밑줄형 큰 칸으로 바꾼다(지금 입력 동작·접근성은 그대로).
   - 아래에 `선생님이세요?`·처리방침 링크를 둔다.
   - 막 내림·준비 중 안내(`NoticeScreen.*`)도 같은 체계로 맞춘다.
2. **V-53 포스터**(`ui/patterns/visitor/EntryPoster.*` + `app/student/StudentExhibition.tsx`의 포스터 층 연결)
   - 위 절반은 **조명 아래 걸린 작품들**로 채운다. 이미 미리 받는 첫 전시실 작품 썸네일을 최대 3장 쓰는데, 그 주소는 `posterView.ts`·`StudentExhibition`에서 찾는다. 포스터 이미지가 있으면 그것을 크게 쓴다.
     - 작품이 없거나 받기 전이면 단색 판으로 둔다.
     - 빛 표현은 그라데이션 대신 작품 둘레의 밝은 매트·테와 바탕 대비로 한다(UI 그라데이션 금지).
   - 아래는 학교·기간 한 줄(작게), 전시 이름(큰 세리프), 별명 한 줄 입력, 캐릭터 둘 고르기(작은 단추형), `처음 쓰는 친구예요`(이미 있음, 유지), 주요 단추 `입장하기`(놋쇠) 차례다.
   - 준비 진행 막대는 주요 단추 바로 위에 같은 폭으로 둔다.
   - 함께 관람 안내 상자는 없애거나 한 줄로 줄인다.
   - 휴대폰 390·태블릿 820·데스크톱 1440에서 깨지지 않게 한다. 데스크톱은 포스터를 가운데 세로 카드나 좌우 2단으로 둔다. 어느 쪽인지 정해 보고한다.
3. 동의 시트(`app/student/ConsentSheet.*`, 공용 `ConsentPanel`)는 색이 새 토큰으로 바뀌는 것만 확인한다. 깨지는 곳만 고친다.

## 고칠 수 있는 파일
- `apps/web/src/app/student/{HomeScreen,NoticeScreen,StudentExhibition}.*`, `app/student/{ConsentSheet,posterView}*`
- `apps/web/src/ui/patterns/visitor/EntryPoster*` (LoadingMuseum은 F8-B 몫 — 고치지 않는다)
- `packages/core/src/copy/ko.ts`: `entry`·`poster` 묶음에 더하기·바꾸기. PRD에 정해진 문구는 바꾸지 않는다. 고치기 직전에 다시 읽고 작은 Edit로.
- 시험 파일(`app/student/*.test.tsx`, `ui/patterns/visitor/visitor.test.tsx`의 포스터 부분), `apps/web/src/dev/student*`

## 건드리지 말 것
- `apps/web/src/app/visit/**`, `viewer/**`, `ui/patterns/visitor/{TopBar,WalkNav,MoveButtons,ZoomCaption,ReactionSheet,NearArtworkCard,DocentBubble}*`(다른 줄 작업 중)
- `ui/themes/*`, `ui/tokens.css`: 새 토큰이 필요하면 보고
- 교사 화면, 서버, `docs/**`, `tests/e2e/**`, `config.ts`, `.env*`, git, 새 의존성

## 끝 조건(FINISH_PLAN §6)
- L1·L2
  - `npx vitest run --project web apps/web/src/app/student apps/web/src/ui/patterns`
  - `npx tsc --noEmit -p apps/web/tsconfig.json`
  - 바꾼 파일만 `npx prettier --check`
  - `node tools/check/index.mjs`
- 기존 시험이 testid·역할로 찾는 것(`entry-home`, `entry-poster`, `enter-plaza-btn`, `char-student-f`, `prepare-progress`, `fresh-start` 등)은 유지한다. 학생 e2e가 쓴다.
- e2e·넓은 검사·캡처는 하지 않는다. 맥미니 자원이 막혀 있어 Claude가 끝에 한 번 돈다.

## 보고(한국어)
바꾼 파일, 실행한 검사(명령·결과 줄), 정한 해석(데스크톱 배치 등), 새 토큰 후보, 고쳐야 할 것(범위 밖)
