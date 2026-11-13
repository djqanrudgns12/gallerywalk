# F9 X2 에셋 마무리

이 파일은 에셋 제작·검수 절차다. PRD·PLAN의 완료 판정은 통합 담당이 한다.

## 만드는 방법

루트 `package.json`에는 `assets:build`가 없다. X2 파일 소유 범위 안의 별도 명령을 사용한다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile build --wait-seconds 560 -- npm run --prefix tools/assets assets:build
```

`pipeline/finish.mjs`는 `.local/art/build/f9-x2-*/`에 기존 산출물 사본과 후보를 남긴다. 기존 Blender 실내·외관 원본을 읽고, 설비만 다시 굽는다. 회랑 문틀은 원래 문 조각의 구운 앞면·UV를 공유하고 겹치는 두께 면만 제거한다. 최적화와 `verifyOutput.mjs`를 통과하고 그림 렌더까지 성공해야 앱의 에셋을 반영한다. 실패한 후보와 이전 산출물은 보존한다.

기본 원본 위치는 `.local/art/build/modern-history`다. 다른 위치는 위 명령 끝에 `-- <원본 폴더>`로 지정한다. Blender 원본을 새로 만들 때는 기존 `blender/build.py`를 사용한다. 전체 실내를 다시 굽지 않아도 되는 회랑 문틀 추가는 `pipeline/corridorDoor.mjs`가 맡는다.

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
