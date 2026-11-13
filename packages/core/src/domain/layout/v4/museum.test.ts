import { describe, expect, it } from 'vitest';
import { config } from '../../../config.ts';
import type { ArtworkForm } from '../../../types/common.ts';
import { type Layout, type LayoutInput, LayoutSchema } from '../../../types/layout.ts';
import { templateGeometry } from '../../templates/geometry.ts';
import { templateGeometryV4 } from '../../templates/geometryV4.ts';
import { computeLayout } from '../computeLayout.ts';
import { inRect, type P2 } from '../geom.ts';
import { pathClear, roundedPath, standable, walkableRects } from '../paths.ts';

// ── 시험 입력(합성) ───────────────────────────────────────────

const uuid = (n: number, salt = 0): string => {
  const hex = (n * 7919 + salt * 104729 + 1).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
};
const PIXELS: Record<ArtworkForm, { w: number; h: number }> = {
  PANORAMA: { w: 6000, h: 1500 },
  LANDSCAPE: { w: 3000, h: 2000 },
  SQUARE: { w: 2000, h: 2000 },
  PORTRAIT: { w: 2000, h: 3000 },
  TALL: { w: 800, h: 20000 },
  MULTIPAGE: { w: 2480, h: 3508 },
  TEXTCARD: { w: 0, h: 0 },
  SOUND: { w: 0, h: 0 },
};
const KIND = (form: ArtworkForm) =>
  form === 'MULTIPAGE' ? 'PDF' : form === 'TEXTCARD' ? 'TEXT' : form === 'SOUND' ? 'AUDIO' : 'IMAGE';
const FORMS: ArtworkForm[] = ['LANDSCAPE', 'PORTRAIT', 'SQUARE', 'PANORAMA'];

const input = (roomCounts: readonly number[], seed = 1): LayoutInput => {
  const rooms = roomCounts.map((_, r) => ({ id: uuid(r, 900 + seed), order: r, hasBgm: false }));
  let k = 0;
  const artworks = roomCounts.flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => {
      const form = FORMS[k++ % FORMS.length]!;
      return {
        id: uuid(k, seed),
        roomId: rooms[r]!.id,
        order: i,
        kind: KIND(form),
        form,
        featured: false,
        textHeavy: false,
        pixel: PIXELS[form],
        pageCount: null,
      } as const;
    }),
  );
  return { exhibitionId: uuid(1, 777 + seed), templateId: 'modern-history', rooms, artworks, algoVersion: 4 };
};

const v4 = (roomCounts: readonly number[], seed = 1): Layout =>
  LayoutSchema.parse(computeLayout(input(roomCounts, seed)));

const EPS = 2e-3;
const dist = (a: P2, b: P2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const xz = (p: readonly number[]): P2 => [p[0]!, p[2]!];

describe('공간 v4 문법(ADR-071)', () => {
  it('판 3 이하는 그대로 스키마 2, 판 4는 스키마 3 + 새 칸', () => {
    const old = computeLayout({ ...input([4, 4]), algoVersion: config().ALGO_VERSION });
    expect(old.schemaVersion).toBe(2);
    expect(old.zones).toBeUndefined();
    const lay = v4([4, 4]);
    expect(lay.schemaVersion).toBe(3);
    expect(lay.zones?.length).toBeGreaterThan(0);
    expect(lay.gate?.radius).toBe(config().GATE_RADIUS_M);
  });

  it('관은 방 크기 하한 이상(바닥 ≥ 120㎡, 천장 6m), 홀은 폭 20m·천장 10m', () => {
    const lay = v4([2, 5, 8, 3]);
    const V = config().LAYOUT_V4;
    for (const p of lay.parts) {
      expect(p.width * p.depth).toBeGreaterThanOrEqual(120 - EPS);
      expect(p.width % 4).toBe(0);
      expect(p.depth % 2).toBe(0);
    }
    const ceilings = lay.walk.areas.flatMap(a => (a.ceiling === undefined ? [] : [a.ceiling]));
    expect(ceilings).toContain(V.roomHeight);
    expect(ceilings).toContain(V.hall.h);
    const hall = lay.zones!.find(z => z.id === 'hall')!;
    expect(hall.max[0] - hall.min[0]).toBe(V.hall.w);
  });

  it('관당 작품은 8점까지(9점 전시실은 둘로)', () => {
    const lay = v4([9]);
    expect(lay.parts).toHaveLength(2);
    for (const p of lay.parts)
      expect(lay.frames.filter(f => f.partId === p.partId).length).toBeLessThanOrEqual(8);
  });

  it('날개: 3개 이상이면 서쪽에 ⌈N/2⌉, 관끼리 겹치지 않고 N 벽은 홀 벽 바로 뒤', () => {
    const lay = v4([3, 3, 3, 3, 3]);
    const T = config().WALL_THICKNESS_M;
    const hw = config().LAYOUT_V4.hall.w / 2;
    const west = lay.parts.filter(p => p.bounds.max[0] < 0);
    expect(west).toHaveLength(3);
    for (const p of lay.parts) {
      const nearX = p.bounds.max[0] < 0 ? p.bounds.max[0] : p.bounds.min[0];
      expect(Math.abs(Math.abs(nearX) - (hw + T))).toBeLessThan(EPS);
    }
    for (const a of lay.parts)
      for (const b of lay.parts) {
        if (a === b) continue;
        const overlap =
          a.bounds.min[0] < b.bounds.max[0] - EPS &&
          b.bounds.min[0] < a.bounds.max[0] - EPS &&
          a.bounds.min[1] < b.bounds.max[1] - EPS &&
          b.bounds.min[1] < a.bounds.max[1] - EPS;
        expect(overlap).toBe(false);
      }
    // 1~2개면 서쪽만
    expect(v4([4, 4]).parts.every(p => p.bounds.max[0] < 0)).toBe(true);
  });

  it('같은 벽 액자 사이 여백 ≥ 2.0m', () => {
    const lay = v4([8, 6, 7]);
    const gap = config().LAYOUT_V4.frameGapMin;
    const walls = new Map<string, { c: P2; w: number }[]>();
    for (const f of lay.frames.filter(fr => fr.mount === 'WALL')) {
      const key = `${f.partId}:${f.wall}`;
      walls.set(key, [...(walls.get(key) ?? []), { c: xz(f.center), w: f.outer.w }]);
    }
    for (const list of walls.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          expect(dist(a.c, b.c) - (a.w + b.w) / 2).toBeGreaterThanOrEqual(gap - EPS);
        }
  });

  it('정지 지점: 외관 → 홀 → 서쪽 관(정문 쪽부터) → 동쪽 관(안쪽부터) → 대문', () => {
    const lay = v4([2, 2, 2, 2]);
    expect(lay.stops[0]!.kind).toBe('exterior');
    expect(lay.stops[1]!.kind).toBe('hall');
    const last = lay.stops[lay.stops.length - 1]!;
    expect(last.kind).toBe('exit');
    expect(dist(xz(last.anchor.target), xz(lay.gate!.pos))).toBeLessThan(EPS);
    const order = lay.stops.filter(s => s.kind === 'roomIntro').map(s => s.partId);
    const zOf = (pid: string | null) => {
      const p = lay.parts.find(pp => pp.partId === pid)!;
      return { west: p.bounds.max[0] < 0, z: (p.bounds.min[1] + p.bounds.max[1]) / 2 };
    };
    const seq = order.map(zOf);
    expect(seq.map(s => s.west)).toEqual([true, true, false, false]);
    expect(seq[0]!.z).toBeLessThan(seq[1]!.z);
    expect(seq[2]!.z).toBeGreaterThan(seq[3]!.z);
  });

  it('모든 이동 경로가 걸을 수 있는 곳 안(방 사이 문·포털·정문·계단·광장)', () => {
    for (const counts of [[3], [2, 5], [4, 4, 4], [6, 2, 7, 3, 5]]) {
      const lay = v4(counts);
      const rects = walkableRects(lay);
      for (const leg of lay.legs) {
        if (leg.waypoints.length < 2) continue;
        const samples = roundedPath(leg.waypoints.map(xz));
        expect(pathClear(samples, rects), `${counts.join(',')} ${leg.from} → ${leg.to}`).toBe(true);
      }
      expect(standable(lay.walk, xz(lay.walk.spawn.pos))).toBe(true);
      // 처음 서는 자리는 대문 반지름 밖(행동 키가 처음부터 '나가기'가 되지 않게)
      expect(dist(xz(lay.walk.spawn.pos), xz(lay.gate!.pos))).toBeGreaterThan(lay.gate!.radius);
    }
  });

  it('안내판: 관마다 포털 레터링·돌출 사인·소개 벽, 제목은 2.6m 위, 앞 2.5m에 도슨트·장식이 서지 않음', () => {
    const lay = v4([3, 4, 5]);
    const V = config().LAYOUT_V4;
    const signs = lay.signs!;
    for (const p of lay.parts)
      for (const kind of ['portalLettering', 'blade', 'introWall'] as const)
        expect(signs.filter(s => s.kind === kind && s.ref === p.partId)).toHaveLength(1);
    for (const s of signs.filter(x => x.kind === 'portalLettering'))
      expect(s.pos[1] - s.h / 2).toBeGreaterThanOrEqual(V.signTitleMinY - EPS);
    const front = (s: (typeof signs)[number]): P2 => [
      s.pos[0] + Math.sin(s.rotY) * V.signClear,
      s.pos[2] + Math.cos(s.rotY) * V.signClear,
    ];
    const wallSigns = signs.filter(s => s.kind === 'introWall' || s.kind === 'totem');
    const standing = [
      ...lay.npcSpots!.map(n => xz(n.pos)),
      ...lay.decorSlots!.filter(d => d.kind !== 'pendant').map(d => xz(d.pos)),
    ];
    for (const s of wallSigns) {
      const a = xz(s.pos);
      const b = front(s);
      for (const p of standing) {
        // 판 앞 띠(판 폭 × 2.5m) 안에 서 있는 것이 없다
        const along: P2 = [Math.cos(s.rotY), -Math.sin(s.rotY)];
        const rel: P2 = [p[0] - a[0], p[1] - a[1]];
        const t = rel[0] * along[0] + rel[1] * along[1];
        const inFront = (rel[0] * (b[0] - a[0]) + rel[1] * (b[1] - a[1])) / V.signClear;
        expect(Math.abs(t) < s.w / 2 && inFront > 0 && inFront < V.signClear, `${s.kind} ${s.ref}`).toBe(
          false,
        );
      }
    }
  });

  it('도슨트 세 자리는 설 수 있는 곳에 있다(자기 자리 바닥을 빼고)', () => {
    const lay = v4([3, 3, 3]);
    const ids = lay.npcSpots!.map(n => n.id).sort();
    expect(ids).toEqual(['docent-hall', 'docent-plaza', 'docent-room']);
    for (const n of lay.npcSpots!) {
      const p = xz(n.pos);
      expect(
        lay.walk.areas.some(a => inRect(p, a)),
        n.id,
      ).toBe(true);
      const others = lay.walk.obstacles.filter(o => !inRect(p, o));
      const blocked = lay.walk.obstacles.length - others.length;
      expect(blocked, n.id).toBe(1);
    }
  });

  it('쓰는 조각은 모두 v3 조각 또는 v4 조각 목록에 있다', () => {
    const known = new Set([
      ...Object.values(templateGeometry['modern-history'].modules),
      ...Object.values(templateGeometryV4['modern-history'].base.modules),
      ...Object.values(templateGeometryV4['modern-history'].modules),
    ]);
    const lay = v4([3, 6, 8, 2, 5]);
    for (const m of lay.modules) expect(known.has(m.type), m.type).toBe(true);
  });

  it('결정성: 같은 입력 → 같은 해시, 입력 배열 순서를 섞어도 같음', () => {
    const a = computeLayout(input([3, 5, 2]));
    const shuffled = input([3, 5, 2]);
    const b = computeLayout({
      ...shuffled,
      artworks: [...shuffled.artworks].reverse(),
      rooms: [...shuffled.rooms].reverse(),
    });
    expect(a.hash).toBe(b.hash);
    expect(computeLayout(input([3, 5, 2])).hash).toBe(a.hash);
  });

  it('걷기 시간 예산(안내 1.6m/s, PRD_V2 §5.4): 같은 관 ≤ 8초, 다음 관 첫 작품 ≤ 15초(날개를 건너는 한 번은 ≤ 25초)', () => {
    const mps = 1.6;
    // 서는 자리: 목표점에서 법선 쪽으로 물러선 곳(작품은 2.5m 또는 물러설 수 있는 만큼, 소개 정지 지점은 포털 안쪽 카메라 자리)
    const stand = (st: Layout['stops'][number]): P2 => {
      const d = st.kind === 'artwork' ? Math.min(2.5, st.anchor.maxDistance) : st.anchor.maxDistance;
      return [st.anchor.target[0] + st.anchor.normal[0] * d, st.anchor.target[2] + st.anchor.normal[1] * d];
    };
    for (const counts of [
      [3, 3],
      [6, 6, 6],
      [8, 8, 8, 8],
    ]) {
      const lay = v4(counts);
      const legLen = (i: number): number => {
        const pts: P2[] = [stand(lay.stops[i]!), ...lay.legs[i]!.waypoints.map(xz), stand(lay.stops[i + 1]!)];
        let s = 0;
        for (let k = 1; k < pts.length; k++) s += dist(pts[k - 1]!, pts[k]!);
        return s;
      };
      for (let i = 0; i + 1 < lay.stops.length; i++) {
        const a = lay.stops[i]!;
        const b = lay.stops[i + 1]!;
        if (a.kind !== 'artwork') continue;
        if (b.kind === 'artwork' && a.partId === b.partId)
          expect(legLen(i) / mps, `${counts} ${a.id}`).toBeLessThanOrEqual(8);
        if (b.kind === 'roomIntro' && lay.stops[i + 2]?.kind === 'artwork') {
          const route = [stand(a), ...lay.legs[i]!.waypoints.map(xz), stand(b), stand(lay.stops[i + 2]!)];
          // 서쪽 날개 끝 → 동쪽 날개 첫 관은 20m 홀을 한 번 가로지른다(메인홀 설계의 몫, PRD_V2 §5.4)
          const west = (pid: string | null) => lay.parts.find(p => p.partId === pid)!.bounds.max[0] < 0;
          const crossing = west(a.partId) !== west(b.partId);
          expect(
            (legLen(i) + legLen(i + 1)) / mps,
            `${counts} ${a.id} → ${b.id} ${JSON.stringify(route)}`,
          ).toBeLessThanOrEqual(crossing ? 25 : 15);
        }
      }
    }
  });
});
