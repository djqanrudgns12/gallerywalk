import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { config } from '../../config.ts';
import type { ArtworkForm } from '../../types/common.ts';
import { type Layout, type LayoutInput, LayoutSchema } from '../../types/layout.ts';
import { computeLayout } from './computeLayout.ts';
import { frameAnchorOf, frameCamera, stopFraming } from './framing.ts';
import { inRect, type P2 } from './geom.ts';
import { route } from './route.ts';
import { templateGeometry } from '../templates/geometry.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import { floorAt, pathClear, roundedPath, standable, walkableRects } from './paths.ts';

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

const FORMS: ArtworkForm[] = [
  'LANDSCAPE',
  'PORTRAIT',
  'SQUARE',
  'PANORAMA',
  'TALL',
  'MULTIPAGE',
  'TEXTCARD',
  'SOUND',
];

const input = (
  roomCounts: readonly number[],
  formAt: (i: number) => ArtworkForm = i => FORMS[i % 4]!,
  seed = 1,
) => {
  const rooms = roomCounts.map((_, r) => ({ id: uuid(r, 900 + seed), order: r, hasBgm: r % 2 === 0 }));
  let k = 0;
  const artworks = roomCounts.flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => {
      const form = formAt(k++);
      return {
        id: uuid(k, seed),
        roomId: rooms[r]!.id,
        order: i,
        kind: KIND(form),
        form,
        featured: false,
        textHeavy: false,
        pixel: PIXELS[form],
        pageCount: form === 'MULTIPAGE' ? 5 : null,
      } as const;
    }),
  );
  return {
    exhibitionId: uuid(1, 777 + seed),
    templateId: 'modern-history',
    rooms,
    artworks,
    algoVersion: config().ALGO_VERSION,
  } satisfies LayoutInput;
};

// ── 점검 도우미 ───────────────────────────────────────────────

const toLogical = (part: Layout['parts'][number], p: P2): P2 => {
  const d: P2 = [p[0] - part.frame.origin[0], p[1] - part.frame.origin[1]];
  return [
    d[0] * part.frame.ax[0] + d[1] * part.frame.ax[1],
    d[0] * part.frame.ay[0] + d[1] * part.frame.ay[1],
  ];
};

const EPS = 2e-3; // 1mm 반올림 두 번

/** 벽마다 액자 구간(벽 방향 좌표)을 모아 여백·벽 안·벽 면 위를 확인 */
const checkWalls = (layout: Layout): void => {
  const c = config();
  currentLayout = layout;
  for (const part of layout.parts) {
    const W = part.width;
    const D = part.depth;
    const bySide = new Map<string, { a: number; b: number }[]>();
    for (const f of layout.frames.filter(x => x.partId === part.partId)) {
      const [x, y] = toLogical(part, [f.center[0], f.center[2]]);
      const half = f.outer.w / 2;
      if (f.mount === 'EASEL' || f.wall === null) {
        checkEasel(part, f, x, y);
        continue;
      }
      const along = f.wall === 'L' || f.wall === 'R' ? y : x;
      // 벽 면 위
      const onPlane = { L: x, F: y - D, R: x - W, N: y }[f.wall];
      expect(Math.abs(onPlane), `${part.partId} ${f.wall} 벽 면 위`).toBeLessThan(EPS);
      const span: [number, number] =
        f.wall === 'N'
          ? [c.DOOR_WIDTH_M + c.DOOR_MARGIN_M, W - c.DOOR_WIDTH_M - c.DOOR_MARGIN_M]
          : [c.CORNER_MARGIN_M, (f.wall === 'F' ? W : D) - c.CORNER_MARGIN_M];
      expect(along - half, `${part.partId} ${f.wall} 시작 여백`).toBeGreaterThanOrEqual(span[0] - EPS);
      expect(along + half, `${part.partId} ${f.wall} 끝 여백`).toBeLessThanOrEqual(span[1] + EPS);
      // 바닥·천장 안
      expect(f.center[1] - f.outer.h / 2).toBeGreaterThan(0.1);
      expect(f.center[1] + f.outer.h / 2).toBeLessThan(c.WALL_HEIGHT_M - 0.2);
      bySide.set(f.wall, [...(bySide.get(f.wall) ?? []), { a: along - half, b: along + half }]);
    }
    for (const [side, list] of bySide) {
      const sorted = [...list].sort((p, q) => p.a - q.a);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]!.a - sorted[i - 1]!.b, `${part.partId} ${side} 액자 사이`).toBeGreaterThanOrEqual(
          c.FRAME_GAP_MIN_M - EPS,
        );
    }
    expect(W % c.MODULE_UNIT_M).toBe(0);
    expect(D % c.MODULE_UNIT_M).toBe(0);
    expect(W).toBeGreaterThanOrEqual(c.ROOM_MIN_W_M);
    expect(D).toBeGreaterThanOrEqual(c.ROOM_MIN_D_M);
    expect(D / W).toBeLessThanOrEqual(c.ROOM_MAX_DW_RATIO + 1e-9);
  }
};

/** 이젤(ADR-057): 방 안쪽 줄(N에서 `EASEL_DEPTH_RATIO`·최소 거리), 앞 = N, 상한 크기, 받침 높이, 이젤 설비가 같은 자리 */
const checkEasel = (
  part: Layout['parts'][number],
  f: Layout['frames'][number],
  x: number,
  y: number,
): void => {
  const c = config();
  expect(f.mount).toBe('EASEL');
  expect(f.wall).toBeNull();
  expect(part.depth).toBeGreaterThanOrEqual(c.EASEL_ROOM_MIN_D_M);
  expect(Math.abs(y - part.depth * c.EASEL_DEPTH_RATIO)).toBeLessThan(EPS);
  expect(x - f.outer.w / 2).toBeGreaterThan(0.5);
  expect(x + f.outer.w / 2).toBeLessThan(part.width - 0.5);
  expect(f.outer.w).toBeLessThanOrEqual(c.EASEL_MAX_OUTER_M.w + EPS);
  expect(f.outer.h).toBeLessThanOrEqual(c.EASEL_MAX_OUTER_M.h + EPS);
  expect(Math.abs(f.center[1] - f.outer.h / 2 - c.EASEL_LEDGE_Y_M)).toBeLessThan(EPS);
  const facingN = toLogical(part, [part.frame.origin[0] + f.normal[0], part.frame.origin[1] + f.normal[1]]);
  expect(Math.abs(facingN[1] + 1)).toBeLessThan(EPS);
  const easel = layout_fixtures(part).find(fx => fx.kind === 'easel' && fx.ref === f.artworkId);
  expect(easel, `${f.artworkId} 이젤 설비`).toBeDefined();
  expect(Math.hypot(easel!.pos[0] - f.center[0], easel!.pos[2] - f.center[2])).toBeLessThan(EPS);
};
let currentLayout: Layout | null = null;
const layout_fixtures = (part: Layout['parts'][number]) =>
  (currentLayout?.fixtures ?? []).filter(fx => fx.partId === part.partId);

/** 작품도 설비도 없는 벽 면(PRD 15.2) — 설비는 그 벽에서 2m 안쪽에 있으면 그 면을 채운 것으로 본다 */
const bareFaces = (layout: Layout, part: Layout['parts'][number]): number => {
  const frames = layout.frames.filter(f => f.partId === part.partId);
  const fx = layout.fixtures.filter(f => f.partId === part.partId && f.kind !== 'nameplate');
  let bare = 0;
  for (const side of ['L', 'F', 'R', 'N'] as const) {
    if (frames.some(f => f.wall === side)) continue;
    const near = fx.some(f => {
      const [x, y] = toLogical(part, [f.pos[0], f.pos[2]]);
      const dist = { L: x, F: part.depth - y, R: part.width - x, N: y }[side];
      return dist >= -EPS && dist <= 2;
    });
    if (!near) bare++;
  }
  return bare;
};

const cameraOf = (stop: Layout['stops'][number], aspect: number): P2 => {
  const pose = frameCamera(frameAnchorOf(stop.anchor), { aspect }, stopFraming(stop.anchor.floorY));
  return [pose.position.x, pose.position.z];
};

/** 키 큰 설비의 실제 바닥(걷기 여유를 뺌) — 카메라가 지나가면 안 됨 */
const tallFootprints = (layout: Layout) => {
  const m = config().WALKABLE_WALL_MARGIN_M;
  return layout.walk.obstacles
    .filter(o => o.tall)
    .map(o => ({ min: [o.min[0] + m, o.min[1] + m] as P2, max: [o.max[0] - m, o.max[1] - m] as P2 }));
};

/**
 * 정지 지점 사이 카메라 길(§4.8 + ADR-057): 카메라 자리 → 경로점 → 카메라 자리, 마디마다 `route`(키 큰 설비 돌기)로 이은 뒤
 * 둥글린 길이 걸을 수 있는 곳 안이고 키 큰 설비를 지나지 않는다.
 */
const checkPaths = (layout: Layout, aspect: number): void => {
  const rects = walkableRects(layout);
  const tall = tallFootprints(layout);
  const byId = new Map(layout.stops.map(s => [s.id, s]));
  for (const leg of layout.legs) {
    const marks: P2[] = [
      cameraOf(byId.get(leg.from)!, aspect),
      ...leg.waypoints.map(w => [w[0], w[2]] as P2),
      cameraOf(byId.get(leg.to)!, aspect),
    ];
    const pts: P2[] = [marks[0]!];
    for (let i = 1; i < marks.length; i++) {
      const r = route(layout.walk, marks[i - 1]!, marks[i]!, { tallOnly: true });
      expect(r, `${leg.from} → ${leg.to} 길 없음(화면 비율 ${aspect.toFixed(2)})`).not.toBeNull();
      pts.push(...r!.slice(1));
    }
    const samples = roundedPath(pts);
    const bad = samples.find(p => !pathClear([p], rects));
    expect(bad, `${leg.from} → ${leg.to} (화면 비율 ${aspect.toFixed(2)})`).toBeUndefined();
    const hit = samples.find(p => tall.some(r => inRect(p, r)));
    expect(hit, `${leg.from} → ${leg.to} 키 큰 설비를 지나감`).toBeUndefined();
  }
};

const ASPECTS = [16 / 10, 390 / 844];

// ── 시험 ─────────────────────────────────────────────────────

describe('SHA-256·정규 JSON', () => {
  it('표준 시험 벡터', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('여러 블록·한글·이모지(UTF-8 3·4바이트)도 Node crypto와 같다', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 300 }), s => {
        expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
      }),
      { seed: 7, numRuns: 300 },
    );
    const long = '하늘고래🐋'.repeat(97);
    expect(sha256Hex(long)).toBe(createHash('sha256').update(long, 'utf8').digest('hex'));
  });

  it('키 순서·−0·숫자 끝자리에 흔들리지 않는다', () => {
    expect(canonicalJson({ b: 1, a: [0.1 + 0.2, -0] })).toBe(canonicalJson({ a: [0.3, 0], b: 1.0004 }));
    expect(canonicalJson({ hash: 'x', a: 1 })).toBe('{"a":1.000}');
  });
});

describe('관 크기·나누기(§4.3·§4.4)', () => {
  // 크기 표(§4.4)만 보려고 같은 크기의 세로 그림으로 — 섞인 형태에서는 순서 보존 때문에 벽이 넘쳐 나뉠 수 있다(아래 시험)
  const sizes = (n: number) => computeLayout(input([n], () => 'PORTRAIT')).parts.map(p => p.size);

  it.each([
    [1, ['S']],
    [4, ['S']],
    [5, ['M']],
    [8, ['M']],
    [9, ['L']],
    [12, ['L']],
  ] as const)('작품 %i점 → %j', (n, expected) => {
    expect(sizes(n)).toEqual(expected);
  });

  const per = (n: number, form?: (i: number) => ArtworkForm) => {
    const l = computeLayout(input([n], form));
    return l.parts.map(p => l.frames.filter(f => f.partId === p.partId).length);
  };

  it('13점은 7·6, 30점은 10·10·10으로 고르게(같은 크기 세로 그림)', () => {
    expect(per(13, () => 'PORTRAIT')).toEqual([7, 6]);
    expect(per(30, () => 'PORTRAIT')).toEqual([10, 10, 10]);
  });

  it('섞인 30점: 고르게 나눈 뒤 벽이 넘치는 묶음만 다시 반으로(작품 1.35배, ADR-057)', () => {
    expect(per(13)).toEqual([7, 6]);
    expect(per(30)).toEqual([10, 5, 5, 10]);
  });

  it('대표작은 관마다 하나, 지정 대표작은 그대로', () => {
    const base = input([13]);
    const target = base.artworks[9]!;
    const l = computeLayout({
      ...base,
      artworks: base.artworks.map(a => (a.id === target.id ? { ...a, featured: true } : a)),
    });
    for (const p of l.parts)
      expect(l.frames.filter(f => f.partId === p.partId && f.featured)).toHaveLength(1);
    expect(l.frames.find(f => f.artworkId === target.id)?.featured).toBe(true);
  });

  it('섞인 12점에서 큰 대표작이 가운데 뒤쪽이면 앞 작품 7점이 L 벽을 넘겨 둘로 나뉜다(순서 보존 우선)', () => {
    const l = computeLayout(input([12]));
    expect(l.parts.map(p => p.size)).toEqual(['M', 'M']);
    checkWalls(l);
  });

  it('넓은 파노라마만 12점이면 벽이 넘쳐 다시 나뉜다(크기 올리기 → 나누기)', () => {
    const l = computeLayout(input([12], () => 'PANORAMA'));
    expect(l.parts.length).toBeGreaterThan(1);
    checkWalls(l);
  });
});

describe('배치 불변식(§4.11)', () => {
  for (const counts of [
    [1],
    [4],
    [5],
    [8],
    [9],
    [12],
    [13],
    [30],
    [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  ]) {
    it(`전시실 작품 수 ${JSON.stringify(counts)}`, () => {
      const l = computeLayout(input(counts, i => FORMS[i % FORMS.length]!));
      expect(LayoutSchema.safeParse(l).success).toBe(true);
      checkWalls(l);
      for (const p of l.parts) expect(bareFaces(l, p), p.partId).toBeLessThanOrEqual(1);
      const total = counts.reduce((s, n) => s + n, 0);
      expect(l.frames).toHaveLength(total);
      // 외관 + 홀 + (관마다 소개) + 작품 + 출구
      expect(l.stops).toHaveLength(2 + l.parts.length + total + 1);
      expect(l.legs).toHaveLength(l.stops.length - 1);
      for (const aspect of ASPECTS) checkPaths(l, aspect);
    });
  }

  it('정지 지점 순서 = 전시실 순서 · 관 안 작품 순서(순서 보존)', () => {
    const inp = input([7, 13]);
    const l = computeLayout(inp);
    const visited = l.stops.filter(s => s.kind === 'artwork').map(s => s.artworkId);
    expect(visited).toEqual(inp.artworks.map(a => a.id));
    for (const s of l.stops.filter(s => s.kind === 'artwork')) expect(s.index! <= s.count!).toBe(true);
  });

  it('회랑: 같은 쪽 관은 겹치지 않고, 관 입구는 순서대로 하류로', () => {
    const l = computeLayout(input([12, 12, 12, 12, 12, 12]));
    const doors = l.parts.map(p => p.doors.find(d => d.kind === 'IN')!.center[2]);
    for (let i = 1; i < doors.length; i++) expect(doors[i]!).toBeGreaterThan(doors[i - 1]!);
    for (const side of [1, -1]) {
      const same = l.parts.filter(p => Math.sign(p.frame.origin[0]) === side);
      for (let i = 1; i < same.length; i++)
        expect(same[i]!.bounds.min[1]).toBeGreaterThanOrEqual(
          same[i - 1]!.bounds.max[1] + config().PART_GAP_M - EPS,
        );
    }
  });

  it('비어 있는 전시실은 빠지고, 작품이 없으면 홀과 출구만', () => {
    const l = computeLayout(input([0, 3, 0]));
    expect(l.parts).toHaveLength(1);
    const empty = computeLayout(input([]));
    expect(empty.stops.map(s => s.kind)).toEqual(['exterior', 'hall', 'exit']);
    expect(LayoutSchema.safeParse(empty).success).toBe(true);
    checkPaths(empty, 16 / 10);
  });

  it('소리 작품만 있는 전시실은 S 크기, L 벽 한 줄', () => {
    const l = computeLayout(input([5], () => 'SOUND'));
    expect(l.parts[0]!.size).toBe('S');
    expect(new Set(l.frames.map(f => f.wall))).toEqual(new Set(['L']));
    expect(l.labels).toHaveLength(0);
  });
});

describe('미술관 외관·걷기 영역(ADR-057)', () => {
  const g = templateGeometry['modern-history'];
  const e = g.exterior;

  it('첫 정지 지점은 광장의 외관, 처음 서는 자리는 광장 땅 위·설비 밖', () => {
    const l = computeLayout(input([5, 9]));
    expect(l.stops[0]!.kind).toBe('exterior');
    expect(l.stops[0]!.anchor.floorY).toBe(l.exterior.groundY);
    expect(l.exterior.groundY).toBeCloseTo(-e.steps * e.stepRiseM, 6);
    const spawn: P2 = [l.walk.spawn.pos[0], l.walk.spawn.pos[2]];
    expect(standable(l.walk, spawn)).toBe(true);
    expect(floorAt(l.walk, spawn)).toBeCloseTo(l.exterior.groundY, 6);
    expect(l.walk.spawn.pos[1]).toBeCloseTo(l.exterior.groundY, 6);
    // 바라보는 방향 = +Z(정면)
    expect(l.walk.spawn.yaw).toBe(0);
  });

  it('정면 날개 벽은 관이 놓인 폭보다 넓고, 이름판은 한가운데·정문은 지도에', () => {
    for (const counts of [[1], [12, 12, 12, 12], [30, 30]]) {
      const l = computeLayout(input(counts));
      const widest = Math.max(
        ...l.parts.flatMap(p => [Math.abs(p.bounds.min[0]), Math.abs(p.bounds.max[0])]),
        0,
      );
      expect(l.exterior.halfWidth).toBeGreaterThanOrEqual(widest + e.wingOverhangM - EPS);
      expect(l.exterior.facadeZ).toBeLessThan(-g.hall.d);
      const sign = l.fixtures.filter(f => f.kind === 'facadeSign');
      expect(sign).toHaveLength(1);
      expect(sign[0]!.pos[0]).toBe(0);
      expect(l.map.doors.some(d => d.pos[0] === 0 && d.pos[1] < -g.hall.d)).toBe(true);
      // 날개 벽 조각(앞 = 광장, rotY = π)이 현관 양옆을 반폭까지 덮는다
      const wings = l.modules.filter(
        m =>
          m.type === g.modules.facadeWall2 &&
          Math.abs(m.pos[2] - l.exterior.facadeZ) < EPS &&
          Math.abs(Math.abs(m.rotY) - Math.PI) < 1e-3,
      );
      expect(wings).toHaveLength(
        2 * Math.round((l.exterior.halfWidth - e.porticoW / 2) / config().MODULE_UNIT_M),
      );
    }
  });

  it('광장 → 계단 → 현관 → 정문 → 홀: 바닥이 끊기지 않고 계단 기울기 안, 설비를 피해 걸어갈 수 있다', () => {
    const l = computeLayout(input([4]));
    const leg = l.legs.find(x => x.from === 'exterior' && x.to === 'hall')!;
    const hall = l.stops.find(s => s.kind === 'hall')!;
    const marks: P2[] = [
      [l.walk.spawn.pos[0], l.walk.spawn.pos[2]],
      ...leg.waypoints.map(w => [w[0], w[2]] as P2),
      cameraOf(hall, 16 / 10),
    ];
    const pts: P2[] = [marks[0]!];
    for (let i = 1; i < marks.length; i++) {
      const r = route(l.walk, marks[i - 1]!, marks[i]!);
      expect(r, `마디 ${i}`).not.toBeNull();
      pts.push(...r!.slice(1));
    }
    const samples = roundedPath(pts);
    const slope = e.stepRiseM / e.stepRunM;
    let prev: { p: P2; y: number } | null = null;
    for (const p of samples) {
      const y = floorAt(l.walk, p);
      expect(y, `바닥 없음 ${p.join(',')}`).not.toBeNull();
      if (prev) {
        const ds = Math.hypot(p[0] - prev.p[0], p[1] - prev.p[1]);
        expect(Math.abs(y! - prev.y)).toBeLessThanOrEqual(slope * ds + 1e-6);
      }
      prev = { p, y: y! };
    }
    expect(prev!.y).toBe(0);
    // 경로점 높이 = 그 자리 바닥 + 카메라 높이
    for (const w of leg.waypoints)
      expect(w[1]).toBeCloseTo(floorAt(l.walk, [w[0], w[2]])! + config().CAMERA_HEIGHT_M, 2);
  });

  it('막힌 벽 조각(실내 벽·정면 날개 벽·산울타리)의 면을 걸을 수 있는 영역이 건너지 않는다', () => {
    const lengthOf: Record<string, number> = {
      [g.modules.wall4]: 2 * g.tileM,
      [g.modules.wall2]: g.tileM,
      [g.modules.facadeWall2]: config().MODULE_UNIT_M,
      [g.modules.hedge2]: config().MODULE_UNIT_M,
    };
    const strictlyIn = (p: P2, r: { min: P2; max: P2 }): boolean =>
      p[0] > r.min[0] + 1e-6 && p[0] < r.max[0] - 1e-6 && p[1] > r.min[1] + 1e-6 && p[1] < r.max[1] - 1e-6;
    for (const counts of [[1], [2, 5], [4, 7, 3], [12, 12, 12, 12], [30, 30], [3, 3, 3, 3, 3, 3, 3]]) {
      const l = computeLayout(input(counts));
      const bad: string[] = [];
      for (const m of l.modules) {
        const len = lengthOf[m.type];
        if (len === undefined) continue;
        const dir: P2 = [Math.cos(m.rotY), -Math.sin(m.rotY)];
        const n = Math.ceil(len / 0.05);
        for (let k = 1; k < n; k++) {
          const p: P2 = [m.pos[0] + (dir[0] * (len * k)) / n, m.pos[2] + (dir[1] * (len * k)) / n];
          const hit = l.walk.areas.find(a => strictlyIn(p, a));
          if (hit) {
            bad.push(`${m.type}@${m.pos[0]},${m.pos[2]} ↔ 영역 ${hit.min.join(',')}~${hit.max.join(',')}`);
            break;
          }
        }
      }
      expect(bad, counts.join('·')).toEqual([]);
    }
  });

  it('벤치·화분·이젤·가로등은 모두 피할 바닥이 있고, 벤치만 낮다', () => {
    const l = computeLayout(input([5, 9, 13]));
    for (const f of l.fixtures.filter(x => ['bench', 'plant', 'easel', 'lamp'].includes(x.kind))) {
      const o = l.walk.obstacles.find(r => inRect([f.pos[0], f.pos[2]], r));
      expect(o, `${f.kind} ${f.pos.join(',')}`).toBeDefined();
      expect(o!.tall).toBe(f.kind !== 'bench');
    }
  });
});

describe('이젤(ADR-057)', () => {
  const easelIds = (l: Layout) => l.frames.filter(f => f.mount === 'EASEL').map(f => f.artworkId);

  it('관 작품 3점 이상이면 순서 끝 작품이 이젤에(S·M 1점, L 2점)', () => {
    for (const [n, k] of [
      [3, 1],
      [5, 1],
      [9, 2],
    ] as const) {
      const inp = input([n], () => 'LANDSCAPE');
      const l = computeLayout(inp);
      expect(l.parts).toHaveLength(1);
      expect(easelIds(l)).toEqual(inp.artworks.slice(n - k).map(a => a.id));
      checkWalls(l);
    }
  });

  it('2점 이하·소리·파노라마·긴 세로로 끝나면 이젤 없음, 대표작은 이젤에 놓지 않음', () => {
    expect(easelIds(computeLayout(input([2], () => 'LANDSCAPE')))).toEqual([]);
    for (const last of ['SOUND', 'PANORAMA', 'TALL'] as const) {
      const l = computeLayout(input([5], i => (i === 4 ? last : 'LANDSCAPE')));
      expect(easelIds(l), last).toEqual([]);
    }
    const base = input([5], () => 'LANDSCAPE');
    const last = base.artworks[4]!;
    const l = computeLayout({
      ...base,
      artworks: base.artworks.map(a => (a.id === last.id ? { ...a, featured: true } : a)),
    });
    expect(easelIds(l)).not.toContain(last.id);
  });

  it('이젤 정지 지점은 벽 작품 다음(순서 보존), 이젤 앞을 본다', () => {
    const inp = input([9], () => 'SQUARE');
    const l = computeLayout(inp);
    const arts = l.stops.filter(s => s.kind === 'artwork');
    expect(arts.map(s => s.artworkId)).toEqual(inp.artworks.map(a => a.id));
    const ids = new Set(easelIds(l));
    for (const s of arts.filter(x => ids.has(x.artworkId!))) {
      const f = l.frames.find(x => x.artworkId === s.artworkId)!;
      expect(s.anchor.normal).toEqual(f.normal);
      expect(s.anchor.target).toEqual(f.center);
    }
  });
});

describe('결정성(§4.10)', () => {
  const shuffle = <T>(xs: readonly T[]): T[] => [...xs].reverse();

  it('같은 입력 두 번 → 같은 해시, 입력 배열 순서를 섞어도 같음', () => {
    const inp = input([5, 13, 2], i => FORMS[i % FORMS.length]!);
    const a = computeLayout(inp);
    const b = computeLayout({ ...inp, rooms: shuffle(inp.rooms), artworks: shuffle(inp.artworks) });
    expect(b.hash).toBe(a.hash);
    expect(b).toEqual(a);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('다른 전시 ID → 액자 자리는 같다', () => {
    const inp = input([9]);
    const a = computeLayout(inp);
    const b = computeLayout({ ...inp, exhibitionId: uuid(42, 4242) });
    expect(b.frames).toEqual(a.frames);
  });

  it('좌표는 1mm로 반올림되어 있다', () => {
    const l = computeLayout(input([7, 3], i => FORMS[i % FORMS.length]!));
    const numbers: number[] = [];
    const walk = (v: unknown, key = ''): void => {
      if (typeof v === 'number' && key !== 'rotY' && key !== 'yaw') numbers.push(v);
      else if (Array.isArray(v)) v.forEach(x => walk(x, key));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(l);
    for (const n of numbers) expect(Math.abs(n * 1000 - Math.round(n * 1000))).toBeLessThan(1e-6);
  });
});

describe('속성 시험(무작위 입력, 시드 고정)', () => {
  it('크기 올리기·나누기가 끝나고 불변식이 모두 참', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.constantFrom(...FORMS), { minLength: 1, maxLength: 16 }),
        (counts, forms) => {
          const l = computeLayout(input(counts, i => forms[i % forms.length]!));
          expect(LayoutSchema.safeParse(l).success).toBe(true);
          checkWalls(l);
          for (const p of l.parts) expect(bareFaces(l, p)).toBeLessThanOrEqual(1);
          checkPaths(l, 16 / 10);
        },
      ),
      { seed: 20261111, numRuns: 500 },
    );
    // 길 찾기(`route`)로 모든 다리를 걸어 보므로 오래 걸린다(맥미니가 바쁠 때 5초를 넘김)
  }, 60_000);
});
