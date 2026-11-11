# 캐릭터 에셋 규격 (R-4, ADR-057)

관람객 캐릭터 4종(`student-m`·`student-f`·`teacher-m`·`teacher-f`)의 glb가 뷰어에 들어오기 전에 지켜야 할 것.
개념 그림은 `.local/art/r4/`(Codex), 이미지→3D·리깅·애니메이션은 Tripo Studio(사용자 유료 결제·로그인, U-19-9 해결). 최적화는 `node tools/assets/pipeline/character.mjs <원본 glb> <ID>`.

## 1. 파일

- 자리: `apps/web/public/assets/g/chr-1/{id}.glb`(배포 전 최적화본만 저장소에, 원본·중간본은 `.local/art/r4/3d/`). 운영 서버는 `/assets/g/*`를 1년 캐시하므로 파일을 바꾸면 폴더 번호(`chr-1` → `chr-2`)와 `Character.tsx` `CHARACTER_BASE`를 함께 올린다.
- 하나의 glb에 몸 한 덩어리 + 뼈대 + 애니메이션 4개. 먼 거리 LOD `{id}-lod1.glb`는 다른 관람객 인스턴스용(idle 첫 키 하나만, 뷰어가 그 자세로 구워 정적 덩어리로 씀).

## 2. 예산 (캐릭터 하나)

| 항목 | 상한 |
|---|---|
| 삼각형 | 30,000 — Tripo 출력(약 2.8만)을 줄이지 않음(1.2만으로 줄이면 입가가 뭉개짐). 먼 거리 LOD `{id}-lod1.glb` ≤ 3,000 |
| 메시 | 1 (`SkinnedMesh` 하나, 머리카락·옷 포함) |
| 재질 | 1 (`MeshStandardMaterial`, 금속 0, 거칠기 0.5~0.8) |
| 텍스처 | 기본색 1장 1024² KTX2(ETC1S) + 법선 512² KTX2(UASTC). LOD는 기본색 512²만 |
| 뼈 | Tripo Mixamo 뼈대 그대로 65(손가락 포함) — 온몸 스킨은 나 하나뿐이라 둠(ADR-057 보충) |
| glb(최적화 뒤) | ≤ 1.5MB |

## 3. 좌표·크기

- 단위 m, Y 위, **얼굴이 +Z**, 기준점 = 두 발 사이 바닥(0, 0, 0).
- 키: 학생 1.15m, 선생님 1.45m(`config.ts` `CHAR_HEIGHT_M`). 뷰어가 크기를 바꾸지 않으니 파일이 이 키여야 한다.
- 발밑 그림자를 모델에 굽지 않는다(뷰어가 동그란 그늘을 그림). 배경·바닥판 없음.

## 4. 애니메이션 (클립 이름 고정)

| 이름 | 길이 | 설명 |
|---|---|---|
| `idle` | 2~4초 반복 | 가만히(숨쉬기 정도 — 멈춘 화면은 다시 그리지 않으므로 첫 자세가 자연스러워야 함) |
| `walk` | 한 걸음 주기, 반복 | 1.5m/s 기준 보폭(뷰어가 빠르기에 맞춰 재생 속도를 바꿈) |
| `run` | 반복 | 3.2m/s 기준 |
| `wave` | 1.5~2초 한 번 | 손 흔들기 |

- 제자리 애니메이션(root motion 없음). 뿌리 뼈는 움직이지 않는다.

## 5. 품질 검수 (저품질은 쓰지 않음 — 사용자 조건)

- 정면·옆·뒤·3/4 캡처를 개념 그림과 나란히(`.local/art/r4/3d/review/`). 얼굴·머리카락·손·치마가 뭉개지거나 찰흙처럼 보이면 다시.
- 걷기 중 무릎·팔꿈치 꺾임, 치마가 다리를 뚫는지, 머리카락이 목을 뚫는지.
- Antigravity 비평 + 사용자 승인(U-07) 뒤에만 저장소에.

## 6. 최적화 순서(gltf-transform)

Tripo에서: 멀티뷰(앞·왼·오른·뒤) H3.1 최고 품질·30,000면·비공개 → Auto Rig(Humanoid·Mixamo) → Animate 프리셋 `idle`·`walk`·`run`·`wave_goodbye_01` → Export GLB·2k·Export Skeleton·Animation stay in Place 켬.


`준비(키를 자료에 굽기·금속 맵 버림·클립 이름·제자리) → dedup → prune → weld → resample → simplify(3만 넘을 때만) → resize 1024/법선 512 → etc1s/uastc → meshopt`, LOD는 같은 준비본에서 `idle` 첫 키만·simplify(3k)·512. 키·발밑은 양자화 전에 잰다(스킨 메시는 양자화 배율이 역바인드 행렬로 감). 검수 화면 `/dev/characters`.
