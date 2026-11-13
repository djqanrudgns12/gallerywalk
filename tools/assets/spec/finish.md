# F9 X2 에셋 마무리

이 파일은 에셋 제작·검수 절차다. PRD·PLAN의 완료 판정은 통합 담당이 한다.

## 만드는 방법

루트 `package.json`에는 `assets:build`가 없다. X2 파일 소유 범위 안의 별도 명령을 사용한다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile build --wait-seconds 560 -- npm run --prefix tools/assets assets:build
```

`pipeline/finish.mjs`는 `.local/art/build/f9-x2-*/`에 기존 산출물 사본과 후보를 남긴다. 기존 Blender 실내·외관 원본을 읽고, 설비만 다시 굽는다. 회랑 문틀은 원래 문 조각의 구운 앞면·UV를 공유하고 겹치는 두께 면만 제거한다. 최적화와 `verifyOutput.mjs`를 통과하고 그림 렌더까지 성공해야 앱의 에셋을 반영한다. 실패한 후보와 이전 산출물은 보존한다.

기본 원본 위치는 `.local/art/build/modern-history`다. 다른 위치는 위 명령 끝에 `-- <원본 폴더>`로 지정한다. Blender 원본을 새로 만들 때는 기존 `blender/build.py`를 사용한다. 전체 실내를 다시 굽지 않아도 되는 회랑 문틀 추가는 `pipeline/corridorDoor.mjs`가 맡는다.

## GitHub 호스트에서 굽기(F9 X10)

`.github/workflows/assets.yml`은 `workflow_dispatch`만 받으며, `macos-15` ARM64 러너에서 최대 300분 실행한다. 저장소 권한은 `contents: read`다. 커밋·push·배포 단계는 없다. 실행과 결과 채택은 통합 담당이 한다.

1. `npm ci --no-audit --no-fund`로 잠긴 의존성을 설치한다.
2. U-04·ADR-050에서 검증한 **Blender 5.2.3**, **KTX-Software 4.4.2** 공식 배포본을 내려받고 고정 SHA-256과 대조한 뒤 러너 임시 폴더에 푼다. `sudo`·Homebrew·기존 맥미니 도구를 쓰지 않는다.
3. `contract.mjs` → `blender/build.py --only core,exterior`로 실내·외관 원본을 다시 만든다. 설비는 다음 단계에서 만든다. `--no-bake`·표본 인수를 쓰지 않으므로 기존 표본 512·천장 4배와 나머지 품질 설정을 유지한다.
4. `npm run --prefix tools/assets assets:build`로 설비를 굽고 회랑 문틀을 추가한다. 새 원본의 manifest·공통 노출을 사용해 실내·외관·설비 전체를 최적화한다. 기존 `verifyOutput.mjs`의 예산 검사를 통과한 뒤 포스터·카드·장식 검수 그림을 렌더한다. Blender Python 예외는 종료 코드 1로 전달한다.
5. `verifyOutput`의 출력을 `budget.txt`로 보존한다. 같은 후보의 검사는 반복하지 않는다. 성공한 후보와 그림을 모아 `modern-history-candidate-<run_id>-<run_attempt>` 아티팩트로 14일 보관한다. 실패 때도 그때까지의 실행 기록은 올리며, 성공한 최종 후보 폴더가 없으면 채택할 수 없다.

공식 내려받기 주소와 SHA-256(2026-11-13 공식 배포 목록·GitHub release API에서 확인):

| 도구 | 주소 | SHA-256 |
| --- | --- | --- |
| Blender 5.2.3 | <https://download.blender.org/release/Blender5.2/blender-5.2.3-macos-arm64.dmg> | `acc05374485a272342d4b323c15ac01953e7f697da2f1bad8af9c3bf087267a4` |
| KTX-Software 4.4.2 | <https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Darwin-arm64.pkg> | `500bd8f9d63358c3f3a0d83b724c8574436a72c37dc0e4bad90ec1ca38032c3c` |

Blender 해시 출처: <https://download.blender.org/release/Blender5.2/blender-5.2.3.sha256>. KTX 해시 출처: <https://api.github.com/repos/KhronosGroup/KTX-Software/releases/tags/v4.4.2>의 해당 파일 `digest`. ARM64 러너 라벨은 <https://github.com/actions/runner-images#available-images>에서 확인했다.

아티팩트 루트:

- `candidate/apps/web/src/tpl/modern-history/`: 예산 검사·그림 생성 뒤의 `core.glb`, `exterior.glb`, `fixtures.glb`, `manifest.json`, `poster.png`, `template-card.png`.
- `renders/decorations.png`: 장식 형태 검수 그림.
- `budget.txt`: 삼각형·치수·용량 예산 출력.
- `logs/`: 실행 SHA·운영체제·도구 판·다운로드 해시·npm·원본 굽기·마무리 실행 기록.

러너용 손잡이는 `BLENDER_BIN`(실행 파일), `ASSETS_REBUILD_ALL=1`(새 원본 manifest와 외관도 사용), `ASSETS_GITHUB_HOSTED=1`(보호기 확인 생략 선택)이다. 마지막 선택은 `GITHUB_ACTIONS=true`·`RUNNER_ENVIRONMENT=github-hosted`·`RUNNER_OS=macOS`가 모두 맞을 때만 허용된다. 로컬·self-hosted는 계속 실제 `resource-guard` 아래에서 실행한다. `RESOURCE_GUARD_ACTIVE`를 CI에서 임의로 설정하거나 보호기 자체를 변경하지 않는다.

소요 시간은 아직 러너에서 실측하지 않았다. 계획상 1~5시간을 예상하되 대기 시간은 별도이며, CPU로 굽는 경우 300분 제한을 넘을 수도 있다. 첫 실행 뒤 기록으로 보정한다. 아티팩트 생성은 브라우저·실기기·시각 승인 결과를 대신하지 않는다.

## PLAN의 16종과 산출물 대응

| 항목 | 산출물·조립 방식 |
| --- | --- |
| 벽 2m·4m | `mh_wall_2m`, `mh_wall_4m` |
| 문 있는 벽 | `mh_wall_door_2m` |
| 안·바깥 모서리 | `mh_corner_in`, `mh_corner_out` |
| 바닥 | `mh_floor_2x2` 반복 배치 |
| 우물천장·황동 조명 | `mh_ceiling_2x2`, 기존 벽 레일, 새 `spotRail` |
| 입구 홀 묶음 | 기존 홀 문법 조립 + `mh_entrance_4m`, `hallSign` |
| 출구 벽 | 기존 끝 벽 + `exitSign`, 새 `exitPortal` |
| 회랑 문틀 | 새 `mh_corridor_door_2m` |
| 이름판 받침 | `nameplate` |
| 소개 글판 | `introPanel` |
| 벤치 | `bench` |
| 화분 | `plant` |
| 차단봉 | 새 `barrier` |
| 소리 명판 받침 | `soundPlaque` |

별도 추가: `wallSconce` 벽등, `artPlinth` 소개판 아래 석재 받침. 실시간 조명은 만들지 않는다. 유리는 기존 발광 재질이고 그늘은 꼭짓점 색으로 굽는다.

## 배치와 예산

- `modernHistory.ts`의 `decorationsFor`는 기존 대표 벽 이름판·소개판·출구 사인을 기준으로 정적 장식을 돌려준다. 서버의 저장된 `Fixture` 스키마·배치 해시·경로는 바꾸지 않는다.
- 장식 치수는 `templateGeometry.decorations`를 Blender와 뷰어가 공유한다. 바닥 물체 전체는 기존 벽 보행 제외 여유 안에 놓인다. 네 방향·결정성·1mm 좌표 시험이 있다.
- 같은 종류·재질은 전체 전시에서 인스턴스로 묶는다. 새 설비의 재질 수로 계산한 그리기 호출 증가는 최대 8회(조명틀 2, 벽등 2, 차단봉 1, 받침 1, 출구 테 2)다. 실제 프레임 예산과 정지 시 다시 그리기 0은 통합 e2e에서 별도 확인해야 한다.
- 회랑 문틀은 원래 문과 같은 3개 재질을 쓴다. 기존 문틀 임시 모형을 대체할 때의 순증은 실제 장면에서 확인한다.
- `verifyOutput.mjs`는 설비별 삼각형·재질·전체 용량에 더해 새 장식의 실제 glTF 외곽과 회랑 문틀의 두께 면 제거를 확인한다. 기준을 낮추지 않는다.
- 이전 에셋에는 새 모델이 없어 빌드 전까지 장식은 그려지지 않는다. 임시 모형을 새로 추가하지 않는다.

## 그림과 연결할 곳

`render.py`는 실제 기본 분위기를 계약에서 읽고 합성 작품만으로 그림을 만든다.

| 파일 | 용도 |
| --- | --- |
| `poster.png` | 기본 포스터 그림(900×1200) |
| `template-card.png` | 템플릿 카드 그림(960×600) |
| 후보 폴더의 `decorations.png` | 새 장식 형태 검수(1600×1000, 앱에는 복사하지 않음) |

학생 포스터·교사 템플릿 카드의 이미지 연결과 루트 `assets:build` 스크립트 등록은 X2 소유 범위 밖이다. 생성 성공 뒤 통합 담당이 연결한다. Blender 그림은 브라우저 캡처나 사용자 시각 승인을 대신하지 않는다.
