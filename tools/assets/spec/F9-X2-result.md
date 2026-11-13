# F9 X2 인계 — 2026-11-13

**상태: 코드·좁은 검사 완료, 에셋 굽기·그림 생성·시각 검수 미실행. V-38·V-56 최종 완료가 아니다.**

담당: Codex. X2 범위만 수정했다. 다른 줄의 파일은 수정하지 않았다.

최종 X2 코드 범위 지문: `fdadf3e-062d795b`. 공유 트리가 동시에 바뀌므로 X2 변경 경로의 이름·내용만 SHA-256으로 계산했으며 Markdown은 제외했다. 아래 검사 시점 전체 트리의 지문을 소급한 값은 아니다.

## 바꾼 파일

- `packages/core/src/domain/templates/geometry.ts`: 장식 치수 계약 5종.
- `packages/core/src/domain/layout/grammar/modernHistory.ts`: 기존 사인 기반 정적 장식 배치. 원본 배치·공용 스키마·보행 영역 변경 없음.
- `packages/core/src/domain/layout/grammar/modernHistory.test.ts`: 대상 사인·네 방향 보행 여유·결정성·1mm 좌표 시험.
- `apps/web/src/viewer/scene/FixtureModels.tsx`: 새 모델도 종류·재질별 인스턴싱. 모델이 없는 기존 GLB에서는 추가 장식을 생략한다.
- `tools/assets/blender/fixtures.py`: `spotRail`, `wallSconce`, `barrier`, `artPlinth`, `exitPortal` 모델 및 꼭짓점 그늘 굽기 등록.
- `tools/assets/blender/render.py`: 제품 기본 분위기를 읽는 포스터·템플릿 카드·장식 검수 렌더.
- `tools/assets/pipeline/contract.mjs`: 장식 치수·합성 장면 자리·제품 분위기 전달.
- `tools/assets/pipeline/build.mjs`: 지정한 GLB만 최적화하는 선택 인수.
- `tools/assets/pipeline/verifyOutput.mjs`: 새 모델 필수 검사·장식 외곽·회랑 문틀 두께 면 검사.
- `tools/assets/pipeline/decorationBounds.mjs`, `decorationBounds.test.mjs`: 실제 glTF 외곽과 보행 여유 계약 검사.
- `tools/assets/pipeline/corridorDoor.mjs`, `corridorDoor.test.mjs`: 누락된 회랑 문틀을 원래 문 조각의 구운 표면으로 만들고 두께 면만 제거. UV·재질·원본 보존 시험.
- `tools/assets/pipeline/finish.mjs`, `tools/assets/package.json`: 원본 보존 → 설비 굽기 → 후보 검사 → 그림 렌더 → 검사 뒤 반영 절차.
- `tools/assets/spec/finish.md`: 명령·16종 대응표·예산·범위 밖 연결 지점.
- 이 인계 파일.

`apps/web/src/tpl/modern-history/**`에는 변경이 없다.

## 실행한 검사와 결과

새 시험은 각각 구현 전 실패를 확인했다. 장식 자리 6개는 `decorationsFor is not a function`, 외곽·문틀 시험은 아직 없는 구현 모듈의 `ERR_MODULE_NOT_FOUND`였다.

1. `npx vitest run --project core packages/core/src/domain/layout/grammar/modernHistory.test.ts packages/core/src/domain/layout/computeLayout.test.ts --maxWorkers=1` — 통과.

```text
 Test Files  2 passed (2)
      Tests  45 passed (45)
   Start at  10:30:20
   Duration  5.82s (tests 97%, import 2%, transform 2%)
```

2. `node --test tools/assets/pipeline/decorationBounds.test.mjs` — 통과.

```text
✔ 장식 외곽 검사는 봉 받침이 보행 영역에 들어가면 거부한다 (1.1215ms)
✔ 천장 밖·바닥 아래와 계약 자체가 보행 여유보다 큰 경우도 거부한다 (0.121ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 63.820917
```

3. `node --test tools/assets/pipeline/corridorDoor.test.mjs` — 통과.

```text
✔ 회랑 문틀은 원래 구운 표면·UV를 보존하고 두께 면만 제거한다 (3.0365ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 167.986458
```

4. `npx tsc --noEmit -p packages/core/tsconfig.test.json` — 종료 0, 출력 없음.
5. `npx tsc --noEmit -p apps/web/tsconfig.json` — 종료 2. X2 밖 `apps/web/src/viewer/data/exhibitionScene.test.ts:144`, `:153`의 TS2345 두 건. `audio.asset.variants[].ext`가 `string`으로 추론되어 `"webp" | "mp3" | "m4a"`에 맞지 않는다. 해당 파일은 수정하지 않았다. 통합 담당 확인 필요.
6. `node tools/check/index.mjs` — 종료 0, 출력 없음. 이후 변경은 에셋 도구·문서이며 이 검사가 검사하는 앱·core에는 의미 변경 없음(결과 재사용).
7. 바꾼 TS·TSX·MJS·JSON 13파일 `npx prettier --check …` — 종료 0.

```text
Checking formatting...
All matched files use Prettier code style!
```

8. Python `ast.parse`로 `fixtures.py`, `render.py` 구문 검사 — 둘 다 통과. Blender에서 실행한 결과는 아니다.
9. X2 범위 `git diff --check` — 종료 0, 출력 없음.
10. 기존 Blender 원본을 NodeIO로 메모리에 읽어 `addCorridorDoor` 적용: 원래 문 80삼각형 보존, 새 문틀 72삼각형·재질 3개, 최소 좌표 `[0,0,0]`, 최대 좌표 `[2,4,0.6349999904632568]`. 파일에는 쓰지 않았다.

## 미실행과 남은 일

다음 명령은 560초 대기 뒤 반환값 **75**로 끝났다. **자원 대기로 하위 명령은 실행되지 않았다.** 반복 호출하지 않았다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile build --wait-seconds 560 -- npm run --prefix tools/assets assets:build
```

실제 전체 출력(1줄), 로그 `.local/art/f9-x2-build.7aAfzd`:

```text
새 작업 보류: 다른 보호 작업이 실행 중. 기존 작업은 그대로 유지합니다.
```

- 미실행: Blender 굽기, GLB 최적화·산출물 예산 검사, 포스터·카드·장식 검수 그림 생성. 새 모델은 아직 제품 화면에 나타나지 않는다.
- 미실행: 브라우저 캡처·그리기 호출·삼각형·정지 시 다시 그리기 0 실측. 장식 재질로 계산한 호출 증가는 최대 8회이며 실측값이 아니다. 회랑 문틀은 별도 3재질이므로 전체 장면 예산은 통합 e2e에서 확인해야 한다.
- 미실행: 전체 시험·운영 빌드. phase 끝 통합 담당 몫.
- 자원이 허용되면 위 명령을 실행한다. 후보에 남는 `decorations.png`, `poster.png`, `template-card.png`를 시각 검수한다. 출력 모양과 밝기는 아직 검증되지 않았다.
- 범위 밖: 학생 포스터·교사 템플릿 카드에서 생성된 그림을 연결하고, 필요하면 루트 `package.json`에 `assets:build`를 등록한다.
- 16종의 입구 홀·출구 벽은 기존 문법 조립에 설비를 더하는 것으로 해석했다. 단일 거대 GLB 노드로 다시 만들지 않았다.
