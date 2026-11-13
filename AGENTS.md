# 우리들의 아트 갤러리 작업 지침 (모든 에이전트 공용)

> Claude·Codex·Antigravity와 Claude 서브에이전트가 이 저장소에서 일할 때 먼저 읽는다.
> **모든 출력은 한국어로 쓴다** — 보고·진행 문장·질문·커밋 메시지·문서까지 예외 없음(코드 식별자·명령·경로·고유 명칭·오류 원문만 원문).

## 0. 무엇을 기준으로 하나

| 문서 | 맡는 것 |
|---|---|
| `PRD.md` | **무엇을**: 기능·화면·연출 시간·성능 목표·완료 기준(15장). 원본이다 |
| `docs/PLAN.md` | **어떻게**: 구조·엔진 규칙·스키마·시험·위임. §15가 phase와 작업 ID, §17이 설정값·오류 코드 |
| `docs/decisions.md` | **왜**: ADR-001~057 |
| `docs/PRD_REVIEW.md` | PRD의 모순(C)·빈틈(B)·사실 확인(F) |
| `docs/USER_DECISIONS.md` | 사용자만 정할 수 있는 것(U) |
| `docs/briefs/<작업 ID>.md` | 맡은 작업의 범위·완료 기준 |
| `docs/FINISH_PLAN.md` | **남은 일의 순서(V-nn·phase F0~F7)와 실행 규약 §6**: 위임 호출 예산, 기다림·되풀이 금지, 검증 사다리 L0~L6 |

- 우선순위: 사용자의 최신 지시 > PRD `[고정]` > ADR > PLAN > PRD `[추천]`. PRD와 PLAN이 어긋나면 보고한다.
- PRD·PLAN·decisions·USER_DECISIONS·PRD_REVIEW는 Claude(통합 담당)만 고친다. 어긋남을 찾으면 고치지 말고 보고한다.
- `[고정]`은 바꾸지 않는다. `[추천]`을 더 나은 방법으로 바꾸고 싶으면 이유를 보고한다(ADR은 Claude가 쓴다).

## 1. 역할과 파일 소유

- **Claude**: 통합 담당. 배치 엔진·쪽 나눔·공용 타입·관람 엔진(카메라·줌 층·장면 결합)·서버 유스케이스와 라우트 연결·문서.
- **Codex**: 시험, 서버 보안·미디어 처리·작업·저장소, 서비스 워커, 성능·부하 도구, Blender·에셋 파이프라인 스크립트, 운영 스크립트, 그림 생성, 독립 코드 검토.
- **Antigravity**: UI 부품·토큰·테마, 화면 배치 시안, 정적 검사 도구, 문구·처리방침 초안, 디자인 비평.
- **Claude 서브에이전트**: 화면 연결·업로드·소리·어댑터·작은 도메인 모듈(작업마다 Claude가 범위를 정함).
- 파일 소유는 PLAN §16.2가 기준이다. **맡은 파일 밖은 고치지 않는다.** 밖을 고쳐야 하면 보고에 "고쳐야 할 것"으로 적는다. 같은 파일을 두 에이전트가 동시에 고치지 않는다.

## 2. 하지 않는 것

- git commit·push·브랜치 바꾸기·원격 설정. 사용자가 요청할 때 Claude만 한다.
- 배포, `launchd`·터널·`sudo` 실행, 맥미니에서 돌고 있는 서비스 끄기·재시작, CloudFront·Cloudflare 콘솔 설정 바꾸기.
- 비밀값 읽기·쓰기(`.env*`, `secrets/`). 키·토큰을 코드·시험·기록·보고에 넣기.
- 실제 학생 작품·이름 쓰기. 시험·시안 자료는 합성 그림·가상 글·가상 소리만.
- 유료 서비스·SDK 추가, 새 결제(Tripo·Higgsfield 결제는 사용자만).
- 다른 저장소 고치기(`../classlearning` 쌤유니버스, `../writeessay` 글방, rollingthunder 등은 읽기만).
- 아바타 빌드·렌더링을 새로 시작하기.
- 새 의존성 넣기. 필요하면 보고한다(Claude가 판 고정·7일 규칙으로 넣는다).

## 3. 코드 규칙

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. `any` 금지(바깥 값은 `unknown` + zod).
- 층(PLAN §2.4): `domain`(순수 함수, 외부 패키지 금지) / `application` / `ports` / `adapters` / `ui`·`viewer`. `ui/`·`viewer/`는 `adapters/`를 가져오지 않는다.
- **바뀔 수 있는 수치는 `packages/core/src/config.ts`에서만** 온다(PLAN §17.1). 코드·SQL·셰이더에 숫자를 박지 않는다.
- 오류 코드는 `packages/core/src/errors.ts`에만 있다(PLAN §17.2). 새 코드가 필요하면 보고한다.
- **화면 문구는 `packages/core/src/copy/ko.ts`에만** 쓴다. 학생 문구에는 기술 용어(서버, 동기화, 브라우저, 업로드, 오류 코드, 에러)를 쓰지 않는다.
- 바깥 입력(HTTP·기기 저장·파일 메타데이터)은 zod로 검증한다. API 봉투 `{data, requestId}` / `{error:{code,message,retryable,fields}}`. DB는 snake_case·UUID·대문자 상태값.
- 배치 엔진은 결정적이어야 한다: 난수는 `rng.ts`(전시 ID 시드)만, 입력은 정렬해서, 좌표는 1mm 반올림(PLAN §4.10).
- 디자인: 색·그림자·모서리·간격·글꼴은 `apps/web/src/ui/tokens.css`와 `themes/*.css` 변수만. 금지: 이모지, 기본 `<select>`, `backdrop-filter`, UI 그라데이션, 순검정, 네온, 3D 공간을 덮는 큰 패널, 동시에 둘 이상 열린 창(PRD 9.6). 아이콘은 `<Icon name="…">`만.

## 4. 3D 규칙 (PRD 10장, PLAN §2.5·§6)

- 정지 상태에서는 다시 그리지 않는다(`frameloop="demand"`). `invalidate()`는 PLAN §6.11의 경우에만.
- 실시간 그림자·실시간 반사·피사계 심도·후처리 효과 추가 금지. 실시간 조명 2개 이하.
- 그리기 호출 ≤ 100, 보이는 삼각형 ≤ 30만, 작품 텍스처는 상주 관리자(§6.5)를 거쳐서만 올리고 내린다. 직접 `new TextureLoader()` 금지.
- 떼어 낸 기하·재질·텍스처는 `dispose()`. `ImageBitmap`은 `close()`.
- 템플릿 에셋은 `npm run assets:build`의 예산 검사를 통과한 것만 `apps/web/src/tpl/`에 둔다. Blender 원본은 저장소에 넣지 않는다(스크립트로 다시 만듦).

## 5. 검사와 맥미니 자원

- 명령: `npm run check`(형식·타입·검사 도구), `npm run test`, `npm run test:server`, `npm run e2e`, `npm run verify`(넓은 검사).
- 무거운 실행(시험 전체·e2e·빌드·Blender 굽기)은 `resource-guard`로 감싸고 한 번에 하나만 돌린다. 백그라운드로 떼어 내지 않는다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test -- npm run test -- --maxWorkers=1
```

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test -- npx playwright test --workers=1
```

```bash
/Users/bodyking/.local/bin/resource-guard run --profile build -- npm run build
```

- 반환값 75는 자원 대기다(실패가 아님). 바로 다시 돌리지 않고 다른 가벼운 일을 하거나 `--wait-seconds 560`을 쓴다. 같은 검사는 최대 2회 시도 뒤 "미실행"으로 적는다(FINISH_PLAN §6.2). `RESOURCE_GUARD_ACTIVE=1` 안에서는 겹쳐 부르지 않는다.
- 무엇을 언제 돌릴지는 FINISH_PLAN §6.3 표를 따른다. 넓은 검사는 phase 끝에 1회만 하고, 운영 빌드는 CI(`verify`) 결과를 인용한다.
- 작업 중에는 바뀐 범위만 검사한다. 넓은 검사는 phase 끝에 Claude가 한 번 돌린다.
- 같은 실패가 세 번이면 고치기를 멈추고 시도·가설·증거를 보고한다.
- 통과시키려고 기대값을 바꾸거나 단언을 약하게 하지 않는다. 일회용 검증 스크립트를 만들지 않는다.

## 6. 포트와 폴더

- 운영 4520(건드리지 않음), 개발 서버 4521, 개발 웹(Vite) 4522, 터널 메트릭 20243. 다른 앱 포트(쌤유니버스 4380·4390, 글방 4460~4462·20242, rollingthunder 3000·8000·20241)는 건드리지 않는다.
- 개발 DB·미디어·임시 파일은 `.local/`(git 제외). 시안 그림·에셋 원본도 `.local/art/`에 두고, 승인된 것만 저장소에 넣는다.

## 7. 보고 형식

- 한국어로 쓴다.
- 바꾼 파일 목록, 돌린 명령과 실제 출력 마지막 20줄, 화면 작업이면 캡처 경로, 남은 문제, 확인하지 못한 것. 돌리지 않은 검사는 "미실행"이라고 쓴다.
- 수치·해시·ID는 실제 출력에서 옮긴 것만 쓴다.
