import { config } from '@gallery/core/config';
import type { Layout } from '@gallery/core/types';
import type { Tier } from '../textures/residency.ts';

/**
 * 그리는 관(PLAN §6.6 — 자유 관람에 맞춤, ADR-057): 캐릭터가 있는 관 + 캐릭터에서 단계별 반지름 안에 바닥이 닿는 관.
 * 회랑을 걸으면 가까운 관 문 너머가 보이고, 멀어진 관은 떼어 텍스처·기하를 놓는다. 광장에서는 첫 관만(정면이 가림).
 */
export const visibleParts = (
  layout: Layout,
  region: string,
  me: { readonly x: number; readonly z: number },
  tier: Tier,
): Set<string> => {
  const out = new Set<string>();
  const first = layout.parts[0]?.partId;
  if (region === 'exterior') {
    if (first) out.add(first);
    return out;
  }
  if (layout.parts.some(p => p.partId === region)) out.add(region);
  const r = config().VISIBLE_PART_RADIUS_M[tier];
  for (const p of layout.parts) {
    const dx = Math.max(p.bounds.min[0] - me.x, 0, me.x - p.bounds.max[0]);
    const dz = Math.max(p.bounds.min[1] - me.z, 0, me.z - p.bounds.max[1]);
    if (Math.hypot(dx, dz) <= r) out.add(p.partId);
  }
  return out;
};
