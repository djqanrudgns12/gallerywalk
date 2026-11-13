import { config } from '@gallery/core/config';
import { copy, facadeTitle } from '@gallery/core/copy';
import { computeLayout } from '@gallery/core/layout';
import { templateLooks } from '@gallery/core/templates';
import { type Fixture, type Layout, type LayoutInput, LayoutSchema } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import {
  atlasItemsOf,
  type MeasureFace,
  neighborGapM,
  packAtlas,
  planSigns,
  plansInView,
  plateArrays,
  signV4,
  type SignPlan,
  signPaletteOf,
  type SignWordsV4,
  textArrays,
  withoutLegacySigns,
  zoneAt,
} from './signAtlasV4.ts';
import type { SignRoom } from './signs.ts';

// ── 합성 입력(가상 이름·글만) ───────────────────────────────────

const uuid = (n: number, salt: number): string => {
  const hex = (n * 7919 + salt * 104729 + 1).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
};

const layoutOf = (roomCount: number, perRoom = 3): Layout => {
  const rooms = Array.from({ length: roomCount }, (_, r) => ({ id: uuid(r, 901), order: r, hasBgm: false }));
  let k = 0;
  const artworks = rooms.flatMap(room =>
    Array.from({ length: perRoom }, (_, i) => ({
      id: uuid(++k, 1),
      roomId: room.id,
      order: i,
      kind: 'IMAGE' as const,
      form: 'LANDSCAPE' as const,
      featured: false,
      textHeavy: false,
      pixel: { w: 3000, h: 2000 },
      pageCount: null,
    })),
  );
  const input: LayoutInput = {
    exhibitionId: uuid(1, 778),
    templateId: 'modern-history',
    rooms,
    artworks,
    algoVersion: 4,
  };
  return LayoutSchema.parse(computeLayout(input));
};

/** 가짜 글 폭: 한글 1em, 띄어쓰기 0.3em, 숫자·라틴 0.55em */
const fake: MeasureFace = t =>
  Array.from(t).reduce((s, ch) => s + (ch === ' ' ? 0.3 : /[가-힣]/.test(ch) ? 1 : 0.55), 0);

/** 30자(전시실 이름 상한): 띄어쓰기 있는 것 · 없는 것(번갈아) */
const NAMES = [
  '우리 반 친구들이 함께 만든 사계절 그림 이야기 전시실',
  '가나다라마바사아자차카타파하가나다라마바사아자차카타파하거너',
];
/** 200자 소개 */
const INTRO = Array.from({ length: 20 }, () => '가상 소개 글이에요')
  .join(' ')
  .slice(0, 200);

const wordsOf = (layout: Layout, long = true): SignWordsV4 => ({
  title: '합성 봄 전시',
  exit: copy.viewer.signExit,
  totemTitle: '가상 안내',
  rooms: new Map<string, SignRoom>(
    layout.parts.map((p, i) => [
      p.partId,
      { title: long ? NAMES[i % 2]! : `봄 ${i + 1}`, intro: i % 3 === 2 ? null : INTRO },
    ]),
  ),
});

const squash = (s: string): string => s.replace(/\s+/g, '');
const STYLE_MIN: Record<SignPlan['kind'], number> = {
  frieze: 0.22,
  banner: 0.22,
  portalLettering: 0.22,
  blade: 0.12,
  totem: 0.045,
  introWall: 0.045,
  exit: 0.22,
};

describe('공간 v4 안내판 계산(W-03)', () => {
  const layout = layoutOf(12);
  const words = wordsOf(layout);
  const plans = planSigns(layout, words, fake);

  it('배치의 사인 종류 ①~⑦이 모두 계획되고, 글은 압축·자르기 없이 원문 그대로다', () => {
    expect(new Set(plans.map(p => p.kind))).toEqual(
      new Set(['frieze', 'banner', 'portalLettering', 'blade', 'totem', 'introWall', 'exit']),
    );
    expect(plans).toHaveLength(layout.signs?.length ?? -1);
    for (const p of plans) {
      const s = layout.signs![p.index]!;
      const all = p.blocks.flatMap(b => b.lines).join(' ');
      expect(all.includes('…')).toBe(false);
      const room = s.ref ? words.rooms.get(s.ref) : undefined;
      const n = layout.parts.findIndex(q => q.partId === s.ref) + 1;
      const want =
        p.kind === 'frieze'
          ? facadeTitle(words.title)
          : p.kind === 'banner'
            ? words.title
            : p.kind === 'exit'
              ? copy.viewer.signExit
              : p.kind === 'introWall'
                ? `${room!.title} ${room!.intro ?? ''}`
                : p.kind === 'totem'
                  ? `${words.totemTitle} ${layout.parts.map((q, i) => `${i + 1} ${words.rooms.get(q.partId)!.title}`).join(' ')}`
                  : `${n} ${room!.title}`;
      expect(squash(all)).toBe(squash(want));
      for (const b of p.blocks) {
        expect(b.size).toBeGreaterThanOrEqual(STYLE_MIN[p.kind] - 1e-9);
        // 줄마다 크기 비례 폭 그대로가 덩이 안(여백 뺀 폭)
        for (const l of b.lines)
          expect(fake(l, b.face) * b.size).toBeLessThanOrEqual(b.w - 2 * b.margin + 1e-6);
        // 덩이가 판·글 상자 안
        expect(Math.abs(b.cx - p.box.cx) + (b.w - 2 * b.margin) / 2).toBeLessThanOrEqual(p.box.w / 2 + 1e-6);
        expect(Math.abs(b.cy - p.box.cy) + (b.h - 2 * b.margin) / 2).toBeLessThanOrEqual(p.box.h / 2 + 1e-6);
      }
    }
  });

  it('포털 레터링·돌출 사인은 걷는 순서 번호 + 방 이름, 토템은 방 목록', () => {
    const lettering = plans.filter(p => p.kind === 'portalLettering');
    expect(lettering).toHaveLength(12);
    for (const p of lettering) {
      const s = layout.signs![p.index]!;
      expect(p.blocks[0]?.lines).toEqual([String(layout.parts.findIndex(q => q.partId === s.ref) + 1)]);
      // 큰 번호: 이름보다 크다
      expect(p.blocks[0]!.size).toBeGreaterThan(p.blocks[1]!.size);
    }
    const blades = plans.filter(p => p.kind === 'blade');
    expect(blades.every(p => p.doubleSided && p.plate === 'blade')).toBe(true);
    const totem = plans.find(p => p.kind === 'totem')!;
    expect(totem.blocks[1]?.lines.length).toBeLessThanOrEqual(24);
  });

  it('제목 글자 아래 끝은 바닥 2.6m 이상(소개 벽 제목·레터링·돌출 사인·프리즈·홀 출구)', () => {
    const minY = config().LAYOUT_V4.signTitleMinY;
    for (const p of plans) {
      const titles =
        p.kind === 'introWall'
          ? p.blocks.slice(0, 1)
          : p.kind === 'portalLettering' ||
              p.kind === 'blade' ||
              p.kind === 'frieze' ||
              (p.kind === 'exit' && p.zone === 'hall')
            ? p.blocks
            : [];
      for (const b of titles)
        expect(p.pos[1] + b.cy - b.h / 2 + b.margin).toBeGreaterThanOrEqual(minY - 1e-6);
    }
  });

  it('하한에서도 넘치는 돌출 사인은 벽에서 먼 쪽·아래로만 자란다(벽 쪽 끝·위 끝 그대로)', () => {
    const grown = plans.filter(p => p.kind === 'blade' && p.grown);
    expect(grown.length).toBeGreaterThan(0);
    for (const blade of grown) {
      const s = layout.signs![blade.index]!;
      expect(blade.wall.side).not.toBe(0);
      const wallEdge = blade.box.cx + (blade.wall.side * blade.box.w) / 2;
      expect(wallEdge).toBeCloseTo((blade.wall.side * s.w) / 2, 6);
      expect(blade.box.cy + blade.box.h / 2).toBeCloseTo(s.h / 2, 6);
    }
    // 띄어쓰기 없는 30자 이름은 3줄에도 들지 않아 폭이 자란다
    expect(grown.some(p => p.box.w > layout.signs![p.index]!.w + 1e-6)).toBe(true);
    // 짧은 이름이면 자라지 않는다
    const short = planSigns(layout, wordsOf(layout, false), fake);
    expect(short.filter(p => p.kind !== 'totem').some(p => p.grown)).toBe(false);
  });

  it('토템은 받침대 위 판, 판은 바닥에서 위로 자란다', () => {
    const t = plans.find(p => p.kind === 'totem')!;
    const s = layout.signs![t.index]!;
    expect(t.box.cy - t.box.h / 2).toBeCloseTo(signV4().plate.totem.plinthH, 6);
    expect(t.box.h).toBeGreaterThanOrEqual(s.h - signV4().plate.totem.plinthH - 1e-6);
  });

  it('보이는 범위: 지금 구역 + 이웃 구역, 소개 벽은 방 안에서만', () => {
    const zones = layout.zones!;
    const gap = neighborGapM();
    const spawn = layout.walk.spawn.pos;
    expect(zoneAt(zones, spawn[0], spawn[2])?.id).toBe('plaza');
    const atPlaza = plansInView(plans, zones, 'plaza', gap);
    expect(new Set(atPlaza.map(p => p.zone))).toEqual(new Set(['plaza', 'portico']));
    // 홀: 홀 사인(레터링·돌출·토템·출구) + 현관, 방 안 소개 벽은 없음
    const atHall = plansInView(plans, zones, 'hall', gap);
    expect(atHall.some(p => p.kind === 'introWall')).toBe(false);
    expect(atHall.filter(p => p.kind === 'portalLettering')).toHaveLength(12);
    // 서쪽 둘째 방: 그 방 + 같은 날개 이웃 둘 + 홀. 홀 건너 동쪽 방 소개 벽은 없음
    const second = layout.parts[1]!.partId;
    const inRoom = plansInView(plans, zones, second, gap);
    const intro = new Set(inRoom.filter(p => p.kind === 'introWall').map(p => p.zone));
    expect(intro).toEqual(new Set([layout.parts[0]!.partId, second, layout.parts[2]!.partId]));
    expect(inRoom.some(p => p.zone === 'hall')).toBe(true);
    expect(inRoom.some(p => p.zone === 'plaza')).toBe(false);
    // 방 사이 통로(어느 구역에도 없음)는 가까운 구역
    const a = layout.parts[0]!.bounds;
    const b = layout.parts[1]!.bounds;
    const mid: [number, number] = [(a.min[0] + a.max[0]) / 2, (a.max[1] + b.min[1]) / 2];
    expect([layout.parts[0]!.partId, second]).toContain(zoneAt(zones, mid[0], mid[1])?.id);
    // 구역 없는 배치면 모두
    expect(plansInView(plans, [], null, gap)).toHaveLength(plans.length);
  });

  it('아틀라스: 겹침 없이 폭 안, 높이는 2의 거듭제곱, 넘치면 해상도를 같은 비율로 낮춘다', () => {
    const items = atlasItemsOf(plans);
    const big = packAtlas(items, 2048, 1 << 16, 4);
    const small = packAtlas(items, 1024, 1024, 4);
    for (const plan of [big, small]) {
      expect(plan.rects).toHaveLength(items.length);
      expect(Math.log2(plan.height) % 1).toBe(0);
      plan.rects.forEach((r, i) => {
        expect(r.x).toBeGreaterThanOrEqual(4);
        expect(r.x + r.w).toBeLessThanOrEqual(plan.width - 4);
        for (const q of plan.rects.slice(i + 1))
          expect(r.x + r.w <= q.x || q.x + q.w <= r.x || r.y + r.h <= q.y || q.y + q.h <= r.y).toBe(true);
      });
    }
    expect(small.height).toBeLessThanOrEqual(1024);
    expect(small.scale).toBeLessThan(1);
    // 같은 입력이면 같은 결과
    expect(packAtlas(items, 1024, 1024, 4)).toEqual(small);
  });

  it('글 네모: 덩이마다 4정점(양면 사인은 뒤에도), 뒷면은 판 반대쪽 면 밖, uv는 0~1', () => {
    const shown = plansInView(plans, layout.zones!, layout.parts[0]!.partId, neighborGapM());
    const atlas = packAtlas(atlasItemsOf(shown), 2048, 2048, 4);
    const t = textArrays(shown, atlas, signPaletteOf(templateLooks['modern-history']));
    const quads = shown.reduce((s, p) => s + p.blocks.length * (p.doubleSided ? 2 : 1), 0);
    expect(t.position.length).toBe(quads * 4 * 3);
    expect(t.index.length).toBe(quads * 6);
    expect(t.uv.every(v => v >= 0 && v <= 1)).toBe(true);
    // 돌출 사인 하나만으로: 앞 네모는 +앞, 뒤 네모는 −앞 쪽에 판 두께/2 + 띄움만큼
    const blade = shown.find(p => p.kind === 'blade')!;
    const one = textArrays(
      [blade],
      packAtlas(atlasItemsOf([blade]), 2048, 2048, 4),
      signPaletteOf(templateLooks['modern-history']),
    );
    const fx = Math.sin(blade.rotY);
    const fz = Math.cos(blade.rotY);
    const off = signV4().plate.blade.depth / 2 + signV4().lift;
    const along = (i: number): number =>
      (one.position[i * 3]! - blade.pos[0]) * fx + (one.position[i * 3 + 2]! - blade.pos[2]) * fz;
    // 덩이마다 앞 네모(4정점) 다음 뒤 네모(4정점)
    blade.blocks.forEach((_, j) => {
      for (let i = 0; i < 4; i++) {
        expect(along(8 * j + i)).toBeCloseTo(off, 6);
        expect(along(8 * j + 4 + i)).toBeCloseTo(-off, 6);
      }
    });
  });

  it('판: 판 있는 종류만 상자를 만든다(벽 글자는 판 없음)', () => {
    const palette = signPaletteOf(templateLooks['modern-history']);
    const wallOnly = plans.filter(p => p.plate === 'none');
    expect(new Set(wallOnly.map(p => p.kind))).toEqual(
      new Set(['frieze', 'portalLettering', 'introWall', 'exit']),
    );
    expect(plateArrays(wallOnly, palette).position).toHaveLength(0);
    // 상자마다 24정점: 돌출(테·판·봉 3) · 토템(받침·갓·테·판 4) · 현수막(천·봉 둘 3) · 대문 출구 봉 2
    const boxes = (p: SignPlan): number => ({ blade: 3, totem: 4, banner: 3, rail: 2, none: 0 })[p.plate];
    const total = plans.reduce((s, p) => s + boxes(p), 0);
    const pl = plateArrays(plans, palette);
    expect(pl.position.length).toBe(total * 24 * 3);
    expect(pl.normal.length).toBe(pl.position.length);
    // 대문 출구(광장)만 봉
    expect(plans.filter(p => p.plate === 'rail').map(p => p.zone)).toEqual(['plaza']);
  });

  it('v4에서는 옛 사인 설비(정면 이름판·소개판 모델)를 뺀다', () => {
    const kinds = new Set(withoutLegacySigns(layout.fixtures).map((f: Fixture) => f.kind));
    expect(layout.fixtures.some(f => f.kind === 'facadeSign')).toBe(true);
    expect(kinds.has('facadeSign')).toBe(false);
    expect(kinds.has('introPanel')).toBe(false);
    expect(kinds.has('bench')).toBe(true);
  });

  it('방이 하나여도·글이 없는 방은 사인을 건너뛴다(빈 판 없음)', () => {
    const one = layoutOf(1);
    const p1 = planSigns(one, { ...wordsOf(one), rooms: new Map() }, fake);
    // 방 이름이 없으면 소개 벽·토템은 없고, 레터링·돌출 사인은 번호만
    expect(p1.some(p => p.kind === 'introWall' || p.kind === 'totem')).toBe(false);
    for (const p of p1.filter(q => q.kind === 'portalLettering' || q.kind === 'blade'))
      expect(p.blocks.map(b => b.lines.join(''))).toEqual(['1']);
  });
});
