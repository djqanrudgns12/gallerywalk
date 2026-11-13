import { copy } from '@gallery/core/copy';
import { describe, expect, it } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { packSigns, type SignRoom, signItems, type TextArea, visibleSigns, wrapLines } from './signs.ts';

const AREA: TextArea = { w: 1, h: 0.5, z: 0.03 };
const AREAS = { nameplate: AREA, introPanel: AREA, corridorNameplate: AREA, hallSign: AREA, exitSign: AREA };

describe('3D 사인 글(V-03)', () => {
  const view = testExhibitionView([4, 3]);
  // 소개판이 있는 관(빈 벽이 있는 관)에 소개 글을 준다
  const introPart = view.layout.fixtures.find(f => f.kind === 'introPanel')?.partId ?? '';
  const rooms = new Map<string, SignRoom>(
    view.layout.parts.map((p, i) => [
      p.partId,
      { title: `합성 전시실 ${i + 1}`, intro: p.partId === introPart ? '가상 소개 글' : null },
    ]),
  );
  const items = signItems(view.layout, rooms, '합성 전시', AREAS);

  it('전시실 이름판은 그 관 이름, 소개판은 이름 + 교사가 쓴 소개, 홀은 전시 이름, 출구는 인사', () => {
    const first = view.layout.parts[0]!.partId;
    const plate = items.find(s => s.kind === 'nameplate' && s.partId === first);
    expect(plate?.heading).toBe('합성 전시실 1');
    const intros = items.filter(s => s.kind === 'introPanel');
    for (const s of intros) expect(s.heading).toBe(rooms.get(s.partId ?? '')?.title);
    expect(introPart).not.toBe('');
    expect(intros.find(s => s.partId === introPart)?.body).toBe('가상 소개 글');
    const hall = items.find(s => s.kind === 'hallSign');
    expect(hall?.heading).toBe('합성 전시');
    expect(items.find(s => s.kind === 'exitSign')?.heading).toBe(copy.viewer.signExit);
    // 관마다 이름판이 하나씩
    expect(items.filter(s => s.kind === 'nameplate')).toHaveLength(view.layout.parts.length);
  });

  it('글자 자리가 없는 종류는 그리지 않고, 보이는 관의 사인만(홀·출구는 늘)', () => {
    expect(
      signItems(view.layout, rooms, '합성 전시', { nameplate: AREA }).every(s => s.kind === 'nameplate'),
    ).toBe(true);
    const first = view.layout.parts[0]!.partId;
    const shown = visibleSigns(items, new Set([first]));
    expect(shown.every(s => s.partId === null || s.partId === first)).toBe(true);
    expect(shown.some(s => s.kind === 'hallSign')).toBe(true);
  });

  it('아틀라스 자리는 겹치지 않고 폭 안, 높이는 2의 거듭제곱', () => {
    const { rects, height } = packSigns(
      [AREA, { w: 2.7, h: 0.5, z: 0 }, AREA, { w: 0.9, h: 1.3, z: 0 }],
      400,
      1024,
    );
    for (const [i, a] of rects.entries()) {
      expect(a.x + a.w).toBeLessThanOrEqual(1024);
      expect(a.y + a.h).toBeLessThanOrEqual(height);
      for (const b of rects.slice(i + 1))
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(Math.log2(height) % 1).toBe(0);
  });

  it('줄 나누기: 폭을 넘으면 글자 단위로 끊고, 줄 수를 넘으면 끝을 …로', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapLines('가나다라마바', 30, measure, 5)).toEqual(['가나다', '라마바']);
    expect(wrapLines('가나다라마바사아', 30, measure, 2)).toEqual(['가나다', '라마…']);
    expect(wrapLines('첫 줄\n둘째', 100, measure, 5)).toEqual(['첫 줄', '둘째']);
  });
});
