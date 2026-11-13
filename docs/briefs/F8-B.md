# F8-B · 크게 보기·반응·모아 보기·로딩 다시 그리기(V-55) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk
**모든 출력(보고·진행 문장)은 한국어로 쓴다.**

## 배경
F8-A와 같다(`docs/briefs/F8-A.md`의 배경·원칙을 그대로 따른다). 방향 A "어두운 전시관 안내 체계", 토큰 `ui/themes/gallery-dark.css`.
- 시안: `/private/tmp/claude-501/-Users-bodyking-Desktop-Architecture-gallerywalk/5c52a56e-7aa0-40a4-8679-f3a018ed8deb/scratchpad/design-v50/project/Main.dc.html`
  - 오른쪽 = 관람 중 안내판. 각진 숯색 판, 1px 테, 놋쇠 강조 하나.

## 할 일(V-55)
1. **크게 보기 캡션** `ui/patterns/visitor/ZoomCaption.*`
   - 숯색 판, 큰 세리프 제목, 작가는 작게. `더 보기`·`반응 남기기`는 한 줄.
   - 보내지 못한 반응 점(`pendingDot`)은 유지한다.
2. **반응 시트** `ui/patterns/visitor/ReactionSheet.*`
   - 같은 판 체계를 쓴다. 스티커 단추 4개(아이콘)는 각진 판, 고른 것은 놋쇠 테로 표시한다.
3. **모아 보기** `app/visit/CollectionSheet.*`
   - 어두운 시트. 썸네일은 액자처럼 얇은 테, 전시실 탭은 밑줄형.
4. **가까운 작품 카드·도슨트 말풍선** `ui/patterns/visitor/{NearArtworkCard,DocentBubble}*`
   - 같은 판 체계를 쓴다. 말풍선 꼬리 같은 장식은 줄인다.
5. **로딩** `ui/patterns/visitor/LoadingMuseum.*`
   - 어두운 바탕 + 가는 놋쇠 진행선. 건물 선그림은 남겨도 된다.
   - F8-A가 포스터 뒤 준비 화면 때문에 이 파일을 건드리면 충돌한다. 그래서 **LoadingMuseum은 F8-B만 고친다.** F8-A에도 같은 안내가 갔다.
6. **2D 대체 화면** `app/visit2d/Visit2DScreen.module.css`
   - 새 토큰에서 깨지는 곳만 맞춘다.

## 고칠 수 있는 파일
- `apps/web/src/ui/patterns/visitor/{ZoomCaption,ReactionSheet,NearArtworkCard,DocentBubble,LoadingMuseum}*`
- `apps/web/src/app/visit/CollectionSheet.*`, `apps/web/src/app/visit2d/Visit2DScreen.module.css`
- `apps/web/src/app/reactions/*.module.css`(있으면, 반응 층 모양만)
- `packages/core/src/copy/ko.ts`: 더하기만, 고치기 직전에 다시 읽고 작은 Edit로
- 시험 파일(해당 부품 시험)

## 건드리지 말 것
- `apps/web/src/app/visit/{walkUi,VisitScreen,PageZoom,TextZoom}*`, `ui/patterns/visitor/{TopBar,WalkNav,MoveButtons}*`(Claude가 안내판 정리 중)
- `ui/patterns/visitor/EntryPoster*`, `app/student/**`(F8-A 작업 중)
- `ui/themes/*`, `ui/tokens.css`(새 토큰은 보고), 교사 화면, 서버, `viewer/**`, `docs/**`, `tests/e2e/**`, `config.ts`, `.env*`, git, 새 의존성

## 끝 조건
- L1·L2
  - `npx vitest run --project web apps/web/src/ui/patterns apps/web/src/app/visit apps/web/src/app/visit2d apps/web/src/app/reactions`
  - `npx tsc --noEmit -p apps/web/tsconfig.json`
  - 바꾼 파일만 `npx prettier --check`
  - `node tools/check/index.mjs`
- testid·역할 이름(`zoom-caption`, `zoom-react`, `reaction-sheet`, `collection-sheet` 등)은 유지한다.
- e2e·넓은 검사·캡처는 하지 않는다(자원 막힘, Claude가 끝에 한 번).

## 보고(한국어)
바꾼 파일, 실행한 검사(명령·결과 줄), 정한 해석, 새 토큰 후보, 고쳐야 할 것
