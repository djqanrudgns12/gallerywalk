# F2-A · 교사 화면 기능 완성(V-16~V-19) — 맡는 곳: Claude 서브에이전트

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 읽을 것
- AGENTS.md
- `docs/FINISH_PLAN.md` §3.2(V-16~V-19), §4 F2, **§6 실행 규약 전부**
- PRD G-07·G-10·G-16·6.9, 15.4-7
- `docs/briefs/F1-A.md`(지난 줄이 만든 것: 붙여넣기·포스터·캐릭터)

## 할 일(차례대로)
1. **V-16 투어 조작**(`app/teacher/tour/TourScreen.tsx`)
   - 재생 중 입력이 없으면 조작판·커서를 숨긴다. 숨길 시간은 `config().IDLE_DIM_SEC`처럼 기존 값을 쓰고, 새 값이 필요하면 설정값 후보로 보고한다.
   - 마우스를 움직이거나 누르면 다시 보인다.
   - 화면(장면)을 누르면 멈춤/재생.
   - `→`/`←` = 다음/이전 전시실 시작으로(PRD G-16). 지금 10초 감기는 진행 막대 키보드(슬라이더 초점일 때)로만 남긴다.
   - Space·Esc는 그대로.
   - 시간표(`planTour`)에서 전시실 시작 시각을 얻는다.
   - 시험: 키(Space·→·←·Esc)·숨김·누르기 단위 시험(`TourScreen.test.tsx`).
2. **V-17 열린 뒤에도 설정 바꾸기**
   - `···` 메뉴에 `반응·투어 설정` → 시트 하나. 반응 설정은 만들기 화면의 반응 설정 부품을 다시 쓰고, 투어 시간(노래 길이에 맞춤 / 전시실마다 ○초)도 넣는다.
   - 저장은 기존 `patchExhibition`(settings)을 쓴다. 열린 동안 바꾸면 학생은 다음 확인(60초) 때 받는다.
   - 시험: 시트에서 바꾸면 patch 호출·메뉴에서 열기.
3. **V-18 결과 한 줄**
   - 올리기 결과에 쪽 나눔이 있으면 `copy.teacher.upload.pageSplitCount`류 한 줄(PRD 6.9 "웹툰이라 3쪽으로 나눠 보여 줘요" — 문구는 `ko.ts`에 있는 것 확인 뒤 필요하면 더함).
   - 카드 쪽 수(`ArtworkBoard.tsx:63` 근처)에 그림 쪽 나눔(긴 세로·파노라마·글 많음)도 센다. 그 수는 `packages/core`의 쪽 계획기를 화면 크기 기준 데스크톱으로 쓰거나, 서버가 주는 값이 있으면 그것을 쓴다. 어느 쪽인지 보고한다.
   - 한 장이면 쪽 수를 숨긴다(비평 문구 20번).
4. **V-19** 휴대폰(`(pointer: coarse)` 또는 767px 이하)에서 `폴더 고르기` 단추와 "화면 어디에 놓아도 올라가요" 끌어 놓기 안내를 숨긴다(비평 28번).

## 고칠 수 있는 파일
- `apps/web/src/app/teacher/tour/**`
- `apps/web/src/app/teacher/manage/{ManageMenu,ArtworkBoard,SettingsSheet}*`(SettingsSheet는 새로)
- `apps/web/src/app/teacher/upload/{DropZone,UploadTray,upload.module.css}*`
- `apps/web/src/app/teacher/home/NewExhibition.tsx`: 반응·투어 설정 부품을 꺼내 함께 쓰려고 할 때만
- `packages/core/src/copy/ko.ts`: `teacher`·`tour` 묶음에 더하기만. 고치기 직전에 다시 읽고 작은 Edit로.
- 시험 파일, `apps/web/src/dev/teacher*`

## 건드리지 말 것
- `apps/web/src/app/visit/**`, `viewer/**`, `app/student/**`, `app/visit2d/**`, `ui/patterns/visitor/**`(Claude 작업 중)
- `app/teacher/manage/{ManageExhibition,PreviewLayer}.tsx`(고쳐야 하면 보고)
- `config.ts`, 서버, `docs/**`, `tests/e2e/**`(이번엔 e2e를 고치지 않음), `.env*`, git, 새 의존성
- 맥미니 서비스, 운영 4520

## 끝 조건(§6.3)
- L1: 새 시험은 구현 전에 써서 실패를 본다.
- L2: `npx vitest run --project web apps/web/src/app/teacher`, `npx tsc --noEmit -p apps/web/tsconfig.json`, 바꾼 파일만 `npx prettier --check`, `node tools/check/index.mjs`
- **L3·넓은 검사는 하지 않는다.** 맥미니 자원이 다른 프로젝트 작업에 묶여 있어 phase 끝에 Claude가 한 번 돌린다.

## 보고(한국어)
바꾼 파일, 실행한 검사(명령·결과 줄), 미실행과 까닭, 정한 해석, 설정값 후보, 고쳐야 할 것(범위 밖)
