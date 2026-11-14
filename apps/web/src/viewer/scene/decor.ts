import { config } from '@gallery/core/config';
import { type DecorSlot, DecorSlotSchema, type Layout } from '@gallery/core/types';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Tier } from '../textures/residency.ts';

/**
 * 공간 v4 장식(PRD_V2 W-04, M5-3) — 순수 계산. 그리기는 `Decor.tsx`.
 *
 * 배치의 `decorSlots`(광장 분수·화분, 홀 조형·흉상·펜던트·안내 데스크, 전시실 조형)를 종류별 인스턴스 행렬로 묶는다.
 * - 보이는 범위: 도슨트와 같은 규칙(`drawnDocentIds`) — 바깥(광장)이면 광장·현관, 실내면 홀 + 그리는 관(`visibleParts`).
 * - 모양: `fixtures.glb`에 종류 이름의 모델(M5-1)이 있으면 그것, 없으면 비슷한 설비 모델을 장식 바닥 넓이에 맞게 키워
 *   다시 쓰고(화분·토피어리 → `plant`), 그것도 없으면 임시 모형(종류 이름 키).
 * - 품질 낮음(LOW)이면 `DECOR.lowTierKinds`의 종류만(`decorKindsFor`).
 * - 스키마 2 배치면 빈 결과. 종류 순서는 스키마 enum 순서, 자리 순서는 배치 순서(배치 엔진이 이미 정렬) — 결정적.
 */

export type DecorKind = DecorSlot['kind'];
/** 묶음 순서(스키마 enum 순서) */
export const DECOR_KINDS: readonly DecorKind[] = DecorSlotSchema.shape.kind.options;

/** 같은 이름 모델이 없을 때 다시 쓸 `fixtures.glb` 설비 모델 */
const MODEL_ALIAS: Readonly<Partial<Record<DecorKind, string>>> = { planter: 'plant', topiary: 'plant' };

export type DecorShape =
  | { readonly type: 'model'; readonly name: string; readonly scale: number }
  | { readonly type: 'placeholder'; readonly key: DecorKind };

export interface DecorGroup {
  readonly kind: DecorKind;
  readonly shape: DecorShape;
  readonly count: number;
  /** 인스턴스 행렬(열 우선 4×4)을 이어 붙인 것: 위치 · Y축 회전 · 배율 */
  readonly matrices: Float32Array;
}

/** 설비 바닥 넓이(템플릿 `footprints`) — 다시 쓰는 모델의 배율 기준 */
type Footprints = Readonly<Partial<Record<string, { readonly w: number; readonly d: number }>>>;

/** 종류 → 그릴 모양 */
export const decorShapeOf = (
  kind: DecorKind,
  hasModel: (name: string) => boolean,
  footprints: Footprints,
): DecorShape => {
  if (hasModel(kind)) return { type: 'model', name: kind, scale: 1 };
  const alias = MODEL_ALIAS[kind];
  if (alias !== undefined && hasModel(alias)) {
    const want = (config().LAYOUT_V4.decorFootprint as Readonly<Partial<Record<string, { w: number }>>>)[
      kind
    ];
    const have = footprints[alias];
    const scale = want && have && have.w > 0 ? want.w / have.w : 1;
    return { type: 'model', name: alias, scale };
  }
  return { type: 'placeholder', key: kind };
};

const OUTDOOR: ReadonlySet<string> = new Set(['plaza', 'portico']);

/**
 * 지금 그릴 장식 구역(정렬): 바깥(`exterior`·처음)이면 광장·현관, 실내면 홀 + 그리는 관.
 * 도슨트(`drawnDocentIds`)와 같은 규칙 — 정면이 가려 바깥에서는 실내 장식이 보이지 않는다.
 */
export const decorZonesInView = (
  slots: readonly { readonly zone: string }[],
  region: string,
  visibleParts: ReadonlySet<string>,
): string[] => {
  const outside = region === 'exterior' || region === '';
  const out = new Set<string>();
  for (const s of slots) {
    const outdoor = OUTDOOR.has(s.zone);
    if (outside ? outdoor : s.zone === 'hall' || (!outdoor && visibleParts.has(s.zone))) out.add(s.zone);
  }
  return [...out].sort();
};

/** 그 품질 단계에서 그리는 종류: 낮음(LOW)은 `DECOR.lowTierKinds`만, 높음·보통은 모두 */
export const decorKindsFor = (tier: Tier): Set<DecorKind> => {
  if (tier !== 'LOW') return new Set(DECOR_KINDS);
  const low = new Set(config().DECOR.lowTierKinds);
  return new Set(DECOR_KINDS.filter(k => low.has(k)));
};

/** 보이는 구역(`zones`)의 장식 → 종류별 묶음(그 품질 단계에서 그리는 종류만) */
export const decorGroups = (
  layout: Layout,
  zones: ReadonlySet<string>,
  hasModel: (name: string) => boolean,
  footprints: Footprints,
  tier: Tier,
): DecorGroup[] => {
  if (layout.schemaVersion !== 3) return [];
  const kinds = decorKindsFor(tier);
  const slots = (layout.decorSlots ?? []).filter(s => zones.has(s.zone));
  const out: DecorGroup[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const s = new Vector3();
  for (const kind of DECOR_KINDS) {
    if (!kinds.has(kind)) continue;
    const list = slots.filter(d => d.kind === kind);
    if (list.length === 0) continue;
    const shape = decorShapeOf(kind, hasModel, footprints);
    const k = shape.type === 'model' ? shape.scale : 1;
    const matrices = new Float32Array(16 * list.length);
    list.forEach((d, i) => {
      m.compose(p.set(d.pos[0], d.pos[1], d.pos[2]), q.setFromAxisAngle(up, d.rotY), s.set(k, k, k));
      m.toArray(matrices, i * 16);
    });
    out.push({ kind, shape, count: list.length, matrices });
  }
  return out;
};
