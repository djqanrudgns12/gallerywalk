import { config } from '@gallery/core/config';
import type { Layout } from '@gallery/core/types';

/**
 * 전시실 벽 와시(PRD_V2 W-12 ① 코브 조명 → 벽 위쪽 그라데이션, M3-4) — 순수 계산. 그리기는 `WallWash.tsx`.
 *
 * 공간 v4 전시실의 숯색 벽(#1E1C1A, PRD_V2 §3)은 구운 빛만으로는 거의 검게 보였다. 천장 가장자리 코브 바로 아래에서
 * 아래로 사라지는 따뜻한 가산 띠를 벽마다 깐다(실시간 조명 아님). 문 열림 위에서는 문 위 벽에만 짧게 — 허공에 빛 판이
 * 뜨지 않게. 모든 띠를 한 기하로 합쳐 그리기 1회.
 */

export interface WashStrip {
  /** 벽을 따라 시작·끝(세계 x, z) */
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  /** 방 안쪽 법선 */
  readonly normal: readonly [number, number];
  /** 띠 아래 끝·위 끝 높이(m) */
  readonly bottom: number;
  readonly top: number;
}

export interface WashStyle {
  /** 띠 높이(위 끝에서 아래로 사라질 때까지, m) */
  readonly heightM: number;
}

/** 보이는 전시실(`visible`의 partId)마다 벽 띠. 스키마 3(공간 v4)만 — 아니면 빈 배열 */
export const washStrips = (layout: Layout, visible: ReadonlySet<string>, style: WashStyle): WashStrip[] => {
  if (layout.schemaVersion !== 3) return [];
  const c = config();
  const v4 = c.LAYOUT_V4;
  const w = c.WALL_WASH;
  const out: WashStrip[] = [];
  for (const part of layout.parts) {
    if (!visible.has(part.partId)) continue;
    const floorY = part.doors[0]?.center[1] ?? 0;
    const top = floorY + v4.roomHeight - w.topGapM;
    const bottom = top - style.heightM;
    for (const wall of part.walls) {
      const dx = wall.end[0] - wall.start[0];
      const dz = wall.end[1] - wall.start[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ux = dx / len;
      const uz = dz / len;
      // 이 벽 위의 문: 벽 선에서 가깝고 법선이 같은 쪽
      const cuts = part.doors
        .flatMap(d => {
          const px = d.center[0] - wall.start[0];
          const pz = d.center[2] - wall.start[1];
          const off = Math.abs(px * wall.normal[0] + pz * wall.normal[1]);
          const same = d.normal[0] * wall.normal[0] + d.normal[1] * wall.normal[1] > 0.5;
          if (off > w.doorSnapM || !same) return [];
          const t = px * ux + pz * uz;
          const doorH = d.width >= v4.portal.clear ? v4.portal.h : v4.enfilade.h;
          const half = d.width / 2 + w.doorTrimM;
          return [{ from: t - half, to: t + half, bottom: Math.max(bottom, floorY + doorH + w.doorTopGapM) }];
        })
        .sort((p, q) => p.from - q.from);
      const at = (t: number): [number, number] => [wall.start[0] + ux * t, wall.start[1] + uz * t];
      let t0 = 0;
      for (const cut of cuts) {
        const from = Math.max(t0, cut.from);
        const to = Math.min(len, cut.to);
        if (from > t0) out.push({ a: at(t0), b: at(from), normal: wall.normal, bottom, top });
        if (to > from && cut.bottom < top)
          out.push({ a: at(from), b: at(to), normal: wall.normal, bottom: cut.bottom, top });
        t0 = Math.max(t0, to);
      }
      if (len > t0) out.push({ a: at(t0), b: at(len), normal: wall.normal, bottom, top });
    }
  }
  return out;
};

/**
 * 띠들 → 한 기하(위치·꼭짓점 밝기·삼각형 번호). 밝기 = ((높이 − 와시 아래 끝) ÷ 와시 높이)^`falloff` — 문 위 짧은 띠도
 * 이웃 띠와 같은 높이에서 같은 밝기(이음매 없음). 벽에서 `liftM`만큼 띄운다.
 */
export const washGeometryData = (
  strips: readonly WashStrip[],
  style: WashStyle,
): { positions: Float32Array; shade: Float32Array; index: Uint32Array } => {
  const w = config().WALL_WASH;
  const rows = Math.max(1, w.rows);
  const positions: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  for (const s of strips) {
    const base = positions.length / 3;
    const washBottom = s.top - style.heightM;
    const nx = s.normal[0] * w.liftM;
    const nz = s.normal[1] * w.liftM;
    for (let r = 0; r <= rows; r++) {
      const y = s.bottom + ((s.top - s.bottom) * r) / rows;
      const k = Math.min(1, Math.max(0, (y - washBottom) / style.heightM)) ** w.falloff;
      positions.push(s.a[0] + nx, y, s.a[1] + nz, s.b[0] + nx, y, s.b[1] + nz);
      shade.push(k, k);
    }
    for (let r = 0; r < rows; r++) {
      const i = base + r * 2;
      index.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  return {
    positions: new Float32Array(positions),
    shade: new Float32Array(shade),
    index: new Uint32Array(index),
  };
};
