import { computeLayout } from '@gallery/core/layout';
import type { LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { decideLayoutApply, decideUpdate, partSignature, resumeStop, shouldPoll } from './applyRules.ts';

const room = (r: number) => `00000000-0000-4000-8000-0000000001${String(r).padStart(2, '0')}`;
const art = (k: number) => `00000000-0000-4000-8000-0000000002${String(k).padStart(2, '0')}`;

/** 전시실마다 작품 수 → 배치 입력(작품 ID는 전시실·순서로 고정) */
const input = (counts: readonly number[]): LayoutInput => ({
  exhibitionId: '00000000-0000-4000-8000-000000000001',
  templateId: 'modern-history',
  algoVersion: 1,
  rooms: counts.map((_, r) => ({ id: room(r), order: r, hasBgm: false })),
  artworks: counts.flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => ({
      id: art(r * 20 + i),
      roomId: room(r),
      order: i,
      kind: 'IMAGE' as const,
      form: 'PORTRAIT' as const,
      featured: false,
      textHeavy: false,
      pixel: { w: 2000, h: 3000 },
      pageCount: null,
    })),
  ),
});

const v = { layoutVersion: 3, contentVersion: 5, settingsVersion: 2 };

describe('decideUpdate', () => {
  it('닫힘·준비 중·그대로·내용만·배치', () => {
    expect(decideUpdate(v, { ...v, status: 'CLOSED' })).toEqual({ kind: 'CLOSED' });
    expect(decideUpdate(v, { ...v, status: 'DRAFT' })).toEqual({ kind: 'NOT_READY' });
    expect(decideUpdate(v, { ...v, status: 'OPEN' })).toEqual({ kind: 'NONE' });
    expect(decideUpdate(v, { ...v, contentVersion: 6, status: 'OPEN' })).toEqual({
      kind: 'REFETCH',
      layoutChanged: false,
    });
    expect(decideUpdate(v, { ...v, layoutVersion: 4, status: 'OPEN' })).toEqual({
      kind: 'REFETCH',
      layoutChanged: true,
    });
  });
});

describe('decideLayoutApply', () => {
  const before = computeLayout(input([5, 3, 4]));

  it('다른 전시실에만 작품이 늘면 앞쪽 관에 있는 학생은 조용히(다음 이동 때)', () => {
    const after = computeLayout(input([5, 3, 5]));
    const here = before.stops.find(s => s.artworkId === art(2))!;
    expect(partSignature(before, here.partId!)).toBe(partSignature(after, here.partId!));
    expect(decideLayoutApply(before, after, here.id)).toEqual({
      kind: 'ON_NEXT_MOVE',
      resumeStopId: here.id,
    });
  });

  it('지금 관의 작품이 바뀌면 띠 — 보던 작품이 남아 있으면 그 작품으로', () => {
    const after = computeLayout(input([6, 3, 4]));
    const here = before.stops.find(s => s.artworkId === art(2))!;
    const apply = decideLayoutApply(before, after, here.id);
    expect(apply.kind).toBe('BANNER');
    expect(apply.resumeStopId).toBe(`art:${art(2)}`);
  });

  it('앞 관이 커져 지금 관이 밀려나도 띠(학생이 보던 방이 움직였다)', () => {
    const grown = computeLayout(input([12, 3, 4]));
    const here = before.stops.find(s => s.artworkId === art(41))!;
    expect(decideLayoutApply(before, grown, here.id).kind).toBe('BANNER');
  });

  it('보던 작품이 지워졌으면 같은 관의 소개, 홀·출구는 늘 조용히', () => {
    const after = computeLayout(input([4, 3, 4]));
    const here = before.stops.find(s => s.artworkId === art(4))!;
    expect(resumeStop(after, here)).toBe(`intro:${here.partId}`);
    expect(decideLayoutApply(before, after, 'hall')).toEqual({ kind: 'ON_NEXT_MOVE', resumeStopId: 'hall' });
    expect(decideLayoutApply(before, after, 'exit')).toEqual({ kind: 'ON_NEXT_MOVE', resumeStopId: 'exit' });
    expect(decideLayoutApply(before, after, 'exterior')).toEqual({
      kind: 'ON_NEXT_MOVE',
      resumeStopId: 'exterior',
    });
  });
});

describe('shouldPoll', () => {
  it('보일 때만, 60초마다 또는 화면에 돌아왔을 때', () => {
    expect(shouldPoll(0, 59_999, true, false)).toBe(false);
    expect(shouldPoll(0, 60_000, true, false)).toBe(true);
    expect(shouldPoll(0, 1_000, true, true)).toBe(true);
    expect(shouldPoll(0, 120_000, false, true)).toBe(false);
  });
});
