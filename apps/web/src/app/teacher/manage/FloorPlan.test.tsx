import { copy, fill } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView, testRoomId } from '../../../dev/testView.ts';
import { FloorPlan, type FloorPlanProps } from './FloorPlan.tsx';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const render = (props: FloorPlanProps): HTMLDivElement => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<FloorPlan {...props} />));
  return host;
};

const view = testExhibitionView([4, 3, 5]);
const rooms = [0, 1, 2].map(testRoomId);
const base = { layout: view.layout, roomOrder: rooms, width: 400, height: 230 } satisfies FloorPlanProps;

describe('FloorPlan', () => {
  it('전시실 번호 01~03, 작품 자리 12개, 입구 글자', () => {
    const el = render(base);
    const svg = el.querySelector('[data-testid="floor-plan"]');
    expect(svg?.getAttribute('aria-label')).toBe(copy.teacher.manage.mapLabel);
    expect([...el.querySelectorAll('text')].map(t => t.textContent)).toEqual([
      '01',
      '02',
      '03',
      copy.teacher.manage.mapEntry,
    ]);
    expect(el.querySelectorAll('[data-artwork-id]')).toHaveLength(view.layout.frames.length);
  });

  it('고른 전시실·놓일 전시실 바닥이 밝아지고, 고른 작품에 핀이 선다', () => {
    const artworkId = view.layout.frames[0]?.artworkId ?? '';
    const el = render({
      ...base,
      selectedRoomId: rooms[1] ?? null,
      dropRoomId: rooms[2] ?? null,
      selectedArtworkId: artworkId,
    });
    const floor = (id: string | undefined): Element | null =>
      el.querySelector(`polygon[data-room-id="${id}"]`);
    expect(floor(rooms[1])?.getAttribute('class')).toMatch(/selected/);
    expect(floor(rooms[2])?.getAttribute('class')).toMatch(/drop/);
    expect(floor(rooms[0])?.getAttribute('class')).not.toMatch(/selected|drop/);
    expect(el.querySelector('[data-testid="floor-plan"]')?.getAttribute('data-drop-room')).toBe(rooms[2]);
    expect(el.querySelector('[data-testid="floor-plan-pin"]')?.getAttribute('data-artwork-id')).toBe(
      artworkId,
    );
  });

  it('수업 지도: 전시실별 수만큼 점, 번호 옆에 수', () => {
    const counts = new Map([
      [rooms[0] ?? '', 2],
      [rooms[2] ?? '', 3],
    ]);
    const el = render({ ...base, counts });
    expect(el.querySelectorAll('circle[data-room-id]')).toHaveLength(5);
    expect(el.querySelectorAll(`circle[data-room-id="${rooms[2]}"]`)).toHaveLength(3);
    expect([...el.querySelectorAll('tspan')].map(t => t.textContent)).toEqual([
      fill(copy.teacher.manage.mapPeople, { n: 2 }),
      fill(copy.teacher.manage.mapPeople, { n: 0 }),
      fill(copy.teacher.manage.mapPeople, { n: 3 }),
    ]);
  });

  it('바닥·작품 자리를 누르면 고르기', () => {
    const onPickRoom = vi.fn();
    const onPickArtwork = vi.fn();
    const el = render({ ...base, onPickRoom, onPickArtwork });
    act(() =>
      el
        .querySelector<SVGElement>(`polygon[data-room-id="${rooms[1]}"]`)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(onPickRoom).toHaveBeenCalledWith(rooms[1]);
    const artworkId = view.layout.frames[3]?.artworkId;
    act(() =>
      el
        .querySelector<SVGElement>(`[data-artwork-id="${artworkId}"]`)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(onPickArtwork).toHaveBeenCalledWith(artworkId);
  });

  it('작은 지도는 입구 글자가 없고, 배치가 없으면 빈 안내', () => {
    const el = render({ ...base, mini: true });
    expect([...el.querySelectorAll('text')].map(t => t.textContent)).not.toContain(
      copy.teacher.manage.mapEntry,
    );
    act(() => root?.render(<FloorPlan {...base} layout={null} />));
    expect(el.querySelector('[data-testid="floor-plan"]')?.getAttribute('data-state')).toBe('empty');
    expect(el.textContent).toBe(copy.teacher.manage.mapEmpty);
  });

  it('지도 모양을 부모에게 넘긴다(지도에 놓기 판정용)', () => {
    const onModel = vi.fn();
    render({ ...base, onModel });
    expect(onModel).toHaveBeenLastCalledWith(expect.objectContaining({ width: 400, height: 230 }));
  });
});
