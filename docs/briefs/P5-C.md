# P5-C · 끌어 옮기기(`@dnd-kit`)·PDF 올리기(pdf.js) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 목표
P5-B에서 패키지가 없어 미뤄 둔 두 가지를 마친다. Claude가 패키지를 넣었다(판 고정): `@dnd-kit/core` 6.3.1 · `@dnd-kit/sortable` 10.0.0 · `@dnd-kit/utilities` 3.2.2 · `pdfjs-dist` 6.5.438.
1. **끌어 옮기기**(ADR-032, PLAN §7.4 G-10)
   - 작품 카드 순서와 전시실 칩 순서를 끌어서 바꾼다. 카드를 칩 위로 끌면 그 전시실로 옮긴다.
   - 마우스·**터치**·키보드(`@dnd-kit` 키보드 센서) 모두 된다.
   - 터치는 길게 누르기(지연 센서)로 시작해 스크롤과 겹치지 않게 한다. 지금 있는 Alt+←/→·`앞으로/뒤로`는 남긴다.
2. **PDF 올리기**(PLAN §5, ADR-056)
   - 기기에서 pdf.js로 쪽마다 그림(서버가 받는 형식·크기 규칙대로)을 만든다.
   - 어댑터 `uploadPdf`(이미 있음, 3단계)로 보낸다. 30쪽 넘으면 `E_PDF_PAGES`.
   - 진행률은 쪽 수로 합쳐 보인다.
   - pdf.js 워커는 따로 묶고(교사 묶음 안, 학생 묶음에 들어가지 않게), CMap·표준 글꼴은 자체 배포한다(외부 주소 금지). 크기를 보고한다.
   - `precheck.ts`의 `PDF_PENDING`을 풀고 PDF 사전 검사를 넣는다(쪽 수·암호 걸린 PDF는 `E_FILE_BROKEN`).

## 읽을 것
- AGENTS.md(§2·§3·§5·§7)
- PLAN §5 전부(특히 PDF 쪽), §7.4, §2.5(묶음 나누기), ADR-032·055·056·060, `docs/briefs/P5-B.md`(앞 작업의 지시서)
- 코드
  - `apps/web/src/app/teacher/{manage,upload}/**`
  - `apps/web/src/adapters/api/{client.ts,http.ts}`(`uploadPdf`·`uploadPdfPage`)
  - 서버 `apps/server/src/http/routes/teacher.ts`(PDF 쪽 PUT 규칙)·`apps/server/src/upload/**`(받는 그림 규칙)
  - `apps/web/vite.config.ts`
  - `packages/core/src/config.ts`(`PDF_*`·`WALL_PX` 등)

## 고칠 수 있는 파일
- `apps/web/src/app/teacher/{manage,upload}/**` — `OpenSheet`·`ManageMenu`·`ReactionsTab`·`QrCode`·`contract.ts`는 빼고
- `apps/web/vite.config.ts`: pdf.js 워커·자원 묶기에 필요한 만큼. 서비스 워커 설정은 그대로 둔다.
- `apps/web/public/assets/g/pdfjs/**`(새 폴더, CMap·글꼴을 둘 때)
- `packages/core/src/copy/ko.ts`(`teacher` 묶음에 더하기만, 고치기 직전에 다시 읽고 작은 Edit로)
- 시험(`*.test.ts(x)`), 시험 자료 `apps/web/src/dev/**`

## 건드리지 말 것
- `apps/web/src/app/{student,visit,visit2d,reactions}/**`, `apps/web/src/app/teacher/{home,shared,tour}/**`(공용 부품은 가져다 쓰기만), `apps/web/src/{viewer,ui,sw}/**`
- `apps/server/**`, `packages/core/src/**`(ko.ts 말고), `docs/**`, `tests/e2e/**`(Codex가 교사 e2e 작업 중)
- `.env*`, git, 새 의존성(위 넷 말고), 맥미니 서비스

## 끝 조건
1. 단위 시험(jsdom)
   - 끌기 센서 설정: 터치 지연·키보드
   - 순서 결과 → `reorderArtworks`·`patchArtwork`(전시실 옮기기) 호출
   - PDF: 쪽 수 상한, 쪽 그림 크기 계산, 3단계 호출 순서. pdf.js는 가짜로 주입한다.
   - 새 시험은 고치기 전 코드에서 실패하는지 본다.
2. `npx vitest run --project web apps/web/src/app/teacher apps/web/src/adapters`, `npx tsc -b`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx prettier --check apps/web/src packages/core/src/copy apps/web/vite.config.ts`, `node tools/check/index.mjs`가 통과한다.
3. 실제 개발 서버 확인
   - 시드 전시 하나에 합성 PDF 3쪽을 올린다(시험 안에서 만든 가짜 글 PDF).
   - 관리 화면에서 카드를 끌어 순서를 바꾸고, 터치 크기(390, `hasTouch`)에서 길게 눌러 끈다.
   - 다시 불러와도 남는지 본다. 캡처는 `.local/p5-c/`에 둔다.
   - `resource-guard run --profile test --wait-seconds 600`으로 감싸 포그라운드로 돌린다. 계속 75면 미실행으로 보고한다.
   - 운영 빌드에서 pdf.js 워커가 학생 묶음(`app-*.js`)에 들어가지 않았는지 `npm run build -w @gallery/web` 산출물로 확인한다(`resource-guard --profile build`).

## 보고(한국어)
- 바꾼 파일, 명령과 출력 끝 20줄, 캡처 경로, 묶음 크기
- 정한 해석, 설정값 후보, 서버에서 고칠 것, 미실행
