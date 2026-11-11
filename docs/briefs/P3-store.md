# P3-store · SQLite 저장소(포트 구현) — 맡는 곳: Claude 서브에이전트 (PLAN 소유 X, 맥미니 과부하로 바꿈)

작업 폴더: /Users/bodyking/Desktop/Architecture/gallerywalk

## 목표
서버 포트(`apps/server/src/ports/index.ts`의 `Store`와 저장소 9개)를 better-sqlite3로 구현한다. 유스케이스(`application/**`)가 메모리 저장소 대신 이것으로 그대로 돌아야 한다(PLAN §10, ADR-055·056).

## 읽을 것
AGENTS.md(§3), PLAN §10 전체, ADR-055·056(`docs/decisions.md`), `apps/server/src/ports/index.ts`(행 모양·계약 주석 — **고치기는 `undefined` 칸을 건너뛰고 `null`은 비움**, `transaction`은 던지면 되돌림), 기준 구현 `apps/server/test/support/memoryStore.ts`, 마이그레이션 `apps/server/src/store/migrations/0001_init.sql`, `apps/server/src/store/db.ts`(`openDb`·`migrate`·`transaction`), 유스케이스 `apps/server/src/application/*.ts`와 시험 `apps/server/test/application/application.test.ts`, 기존 저장소 시험 `apps/server/test/store/db.test.ts`.

## 고칠 파일(이것만)
- `apps/server/src/store/repos.ts`(또는 `store/repos/*.ts`로 나눠도 됨) — `createSqliteStore(db): Store`. 준비된 문장을 미리 만들어 씀. 행 ↔ 기록 변환(snake_case ↔ camelCase, 0/1 ↔ 참거짓, JSON 칸 ↔ 값 — JSON 칸은 읽을 때 core zod 스키마로 검사: `ExhibitionSettingsSchema`·`MediaVariantSchema`·`ImageAnalysisWireSchema`/`AudioAnalysisSchema`·`LayoutSchema`·`ArtworkWarningSchema`). `transaction`은 중첩 호출을 허용(안쪽은 바깥 트랜잭션에 합류 — 유스케이스가 `recomputeLayout`을 트랜잭션 안에서 다시 부른다). `pinTaken`은 만료되지 않은 전시만이 아니라 표에 있는 전시 전부(만료 행은 정리 작업이 지움 — PLAN §10.1).
- `apps/server/test/support/sqliteDeps.ts` — `testDeps()`와 같은 모양으로 임시 폴더의 SQLite 저장소를 쓰는 의존성(시험마다 새 DB, 끝나면 지움).
- `apps/server/test/application/application.test.ts` — 같은 시험을 **메모리·SQLite 두 저장소로** 돌리게 바꾼다(`describe.each` 등). 단언은 바꾸지 않는다. 메모리 전용인 `t.store.tables()` 단언은 저장소 공통 조회로 바꾸거나 SQLite용 같은 뜻의 조회를 둔다(뜻이 같아야 함).
- `apps/server/test/store/repos.test.ts` — 저장소 계약 시험: 행 왕복(모든 칸), 고치기에서 `undefined` 건너뛰기·`null` 비우기, 없는 행 고치기 오류, 트랜잭션 되돌림·중첩, 복합 외래키(다른 전시의 전시실로 작품 넣기 거절), JSON 칸이 깨졌을 때 읽기 오류, 배치 `prune`.

## 건드리지 말 것
`apps/server/src/{ports,application}/**`(필요한 것은 보고 — 포트 계약 바꾸기는 Claude가), `store/migrations/**`(표를 바꿔야 하면 보고), `apps/server/src/{http,media}/**`, `apps/server/test/support/memoryStore.ts`, `packages/**`, `apps/web/**`(같은 시각 다른 서브에이전트), `docs/**`, `package.json`, `.env*`, 다른 저장소. git·새 의존성·무거운 실행(`apps/server/test/media`·전체 시험·e2e·빌드) 금지.

## 끝 조건
1. `npx vitest run --project server --maxWorkers=1 apps/server/test/application apps/server/test/store apps/server/test/http apps/server/test/env.test.ts apps/server/test/log.test.ts` 통과(두 저장소 모두).
2. `npx tsc -b && npx tsc -p apps/server/tsconfig.test.json` 통과, `npx prettier --check apps/server` 통과.

## 보고(한국어)
바꾼 파일 · 돌린 명령과 출력 끝 20줄 · 정한 해석 · 필요한 것(포트·표·스키마) · 미실행.
