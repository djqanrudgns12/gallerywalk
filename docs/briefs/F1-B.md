# F1-B · 쪽 나눔 실제 화면 확인(V-08) — 맡는 곳: Claude 서브에이전트 (원래 Codex 몫, Codex 한도로 대신)

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 읽을 것
- AGENTS.md
- `docs/FINISH_PLAN.md` §3.1(V-08), §4 F1 세부, **§6 실행 규약 전부(꼭 지킴)**
- PRD 6.4·6.7, 15.1-4·5, 15.3-4
- ADR-047(휴대폰 세로 A4는 한 장 + 돌리기 안내)
- `tools/dev/seed-exhibition.mjs`·`.test.mjs`
- `tests/e2e/support/exhibition.ts`, `tests/e2e/student.spec.ts`
- `apps/web/src/app/visit/PageZoom.tsx`·`TextZoom.tsx`(쪽 수가 DOM에 어떻게 보이는지)

## 할 일
1. **시드 도구**: 지금 가로·세로·정사각 합성 그림만 만든다. 아래를 더한다(모두 합성·가상 글, 실제 학생 작품·이름 금지).
   - 웹툰 800×20000 PNG(칸 그림 + 가상 글자 줄)
   - 글 많은 A4 2480×3508(가상 글 줄이 촘촘하게)
   - PDF 5쪽. 기존 시험 자료나 서버 시험의 합성 PDF 만드는 법을 찾아 쓴다. 새 의존성은 금지다.
   - 소리 1(짧은 합성 사인파 WAV 등, 서버가 받는 형식)
   - 글 작품 1
   - 기존 옵션 규칙을 따르고, 새 작품은 옵션(예: `--with-pages`)으로 켤지 기본에 넣을지 정해 보고한다.
   - 학생 e2e가 쓰는 시드에는 이 작품들이 들어가야 한다.
2. **도구 시험**(`seed-exhibition.test.mjs`): 새 생성기가 맞는 크기·쪽 수를 만드는지 본다.
3. **학생 e2e**(`student.spec.ts`)
   - 기존 흐름을 바꾸지 말고 **새 시험 하나**를 더한다: 휴대폰 390×844 한 크기에서 PDF 작품과 웹툰 작품을 크게 보고 쪽 넘김 수가 2 이상인지 본다.
   - 데스크톱 1440×900에서 A4는 쪽이 1인지 본다(ADR-047: 휴대폰 세로 A4는 한 장 + 돌리기 안내).
   - 쪽 수를 읽을 DOM 손잡이(`data-page-total` 같은 것)가 없으면 **고칠 수 없는 파일**(`app/visit/**`)이다. 그때는 손잡이 이름을 보고에 "고쳐야 할 것"으로 적는다. 대신 화면에 보이는 쪽 표시 글(`copy.viewer.pageOf`)로 읽는다.
   - 그 작품까지 가는 길은 기존 `walkTo`나 모아 보기를 쓴다.
   - 다른 시험의 기대값(작품 수·정지 지점 수)이 시드 변경으로 바뀌면, 단언을 약하게 하지 말고 시드에서 읽은 값으로 맞춘다.

## 고칠 수 있는 파일
- `tools/dev/seed-exhibition.mjs`·`.test.mjs`
- `tests/e2e/support/exhibition.ts`
- `tests/e2e/student.spec.ts`(새 시험 + 시드 변경으로 꼭 필요한 기대값 맞춤만)

## 건드리지 말 것
- `apps/**`, `packages/**`(Claude·F1-A가 고치는 중)
- `tests/e2e/teacher.spec.ts`, `docs/**`, `.env*`, git, 새 의존성
- 시드 파일 `.local/dev/seed/*.json`: 교사 토큰이 들어 있다. 내용을 출력·보고·캡처에 넣지 않는다.
- 맥미니 서비스, 운영 4520

## 끝 조건(§6.3)
- **L1**: `node --test tools/dev/seed-exhibition.test.mjs`
- **L3 한 번**: `/Users/bodyking/.local/bin/resource-guard run --profile test --wait-seconds 560 -- npx playwright test tests/e2e/student.spec.ts --workers=1`
  - 시드가 바뀌었으므로 학생 spec 전체를 돌린다.
  - 75면 최대 2회까지만 시도한다. 그래도 75면 미실행으로 적는다.
- 실패하면 원인을 2번까지 고쳐 본다. 3번째 실패면 멈추고 증거를 보고한다.
- 넓은 검사는 하지 않는다.

## 보고(한국어)
바꾼 파일, 실행한 검사(명령·결과 줄), 미실행과 까닭, 찾은 화면 결함(쪽이 안 나뉨 등 — 그대로 적기), 고쳐야 할 것(`app/visit/**` 손잡이 등)
