# R-7b · 관람·입장·교사 화면 부품(ui/patterns) — 맡는 곳: Antigravity (standard)

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 목표
R-7 시안 v2(`.local/art/r7/*.html`·캡처, 사용자 확인 전이지만 방향 확정)를 **실제 React 부품**으로 옮긴다. 부품은 가짜 값으로 혼자 돌고(상태·API 없음), Claude가 `screens/**`·`/dev/walk`에서 잇는다(PLAN §16.2 "A(배치) · S(연결)").

## 읽을 것
AGENTS.md(§3 디자인 금지·문구 규칙), ADR-057과 그 보충(`docs/decisions.md` 끝), 시안 `.local/art/r7/`, 토큰·테마 `apps/web/src/ui/tokens.css`·`themes/*.css`, 문구 `packages/core/src/copy/ko.ts`(`viewer.*`·`poster.*`·`live.*` — Claude가 R-7 문구 제안을 넣어 둠. 없는 문구는 고치지 말고 보고), 지금 임시 연결 화면 `apps/web/dev/WalkDev.tsx`(어떤 값이 오는지), 조이스틱 계산 `apps/web/src/viewer/walk/input.ts`의 `stickFromOffset`.

## 만들 것(`apps/web/src/ui/**`만)
- `ui/Icon.tsx` — `<Icon name="…" />` 하나로 쓰는 선 아이콘(인라인 SVG, 24px 격자, `currentColor`): chevron-left/right, map, sound-on/off, menu, zoom-in, close, user, plus, grid, warning, play.
- `ui/patterns/visitor/`:
  - `TopBar` — 전시관 이름·지금 자리·함께 관람 수(0이면 "혼자 둘러보는 중").
  - `WalkNav` — 이전(아이콘만)·"다음 작품으로 {i}/{n}" 큰 버튼, `onPrev`·`onNext`.
  - `NearArtworkCard` — 대표작 배지·제목·작가·짧은 설명·"크게 보기"(`onZoom`).
  - `Joystick` — 보이는 부분 + 포인터 처리: 누른 자리 기준 손잡이, `stickFromOffset` 결과를 `onChange({forward, strafe, run})`로, 떼면 0. 터치 44px 이상.
  - `ZoomCaption` — 제목·작가·긴 설명 펼치기/접기, 닫기 버튼.
  - `WalkHint` — 기기별 한 줄 안내(터치/데스크톱 문구를 prop으로).
  - `LoadingMuseum` — 미술관 외관 실루엣 로딩(CSS 움직임만, `prefers-reduced-motion`이면 멈춤).
  - `EntryPoster` — 포스터 + 별명 입력 + 학생 캐릭터 2종 고르기(그림 자리는 `characterImage` prop, 없으면 실루엣) + 함께 관람 안내 + 입장 버튼. 값은 prop/콜백으로만.
  - 화면 크기 3단(휴대폰 390·태블릿 820/1180·데스크톱 1440) 반응형.
- `ui/patterns/teacher/`:
  - `ArtworkCard` — 카드 안 액자 미리 보기(형태 7종 비율·매트·테·접촉 그림자), 제목·작가·형태·쪽 수·상태 배지·경고, 선택·끌기 상태.
  - `ArtworkGrid` — 데스크톱 4열·태블릿 3열·휴대폰 2열, 끝의 "작품 더 올리기" 카드.
  - `TeacherCharacterDialog` — 선생님 남·여 고르기 + 이름표 입력(창 하나).
- `ui/patterns/**/*.test.tsx`(Vitest + jsdom, 있는 설정 사용): 부품마다 그려짐·콜백·문구가 copy에서 옴·접근성 이름.
- `apps/web/dev/PatternsDev.tsx` + `dev/main.tsx`에 `/dev/patterns` 경로 한 줄 — 부품을 가짜 값으로 한 화면에(3크기 캡처를 `.local/art/r7b/`에).

## 지킬 것
화면 문구는 `copy`에서만(부품 파일에 한글 문자열 금지 — `npm run check:rules`가 잡음). 색·간격·그림자·모서리는 토큰 변수만(hex는 토큰·테마 파일에만). 이모지·기본 `<select>`·`backdrop-filter`·UI 그라데이션·순검정·네온 금지, 3D를 덮는 큰 패널 금지, 동시에 열린 창 하나.

## 건드리지 말 것
`packages/**`, `apps/web/src/{viewer,audio,adapters,ports,screens}/**`, `apps/web/dev/` 중 `PatternsDev.tsx`·`main.tsx`(한 줄) 밖, `apps/server/**`, `docs/**`, `tools/**`, `.env*`, 다른 저장소. git·새 의존성·무거운 실행 금지. 이 실행은 전체 권한이니 범위를 스스로 지킬 것.

## 끝 조건
1. `npx vitest run --project web --maxWorkers=1 apps/web/src/ui` 통과.
2. `npx tsc -p apps/web` 통과, `npm run check:rules` 위반 0, `npx prettier --check apps/web/src/ui apps/web/dev/PatternsDev.tsx`.
3. `/dev/patterns` 3크기 캡처.

## 보고(한국어)
바꾼 파일 · 돌린 명령과 출력 끝 20줄 · 캡처 경로 · 필요한 문구 키(없던 것) · 남은 문제 · 미실행.
