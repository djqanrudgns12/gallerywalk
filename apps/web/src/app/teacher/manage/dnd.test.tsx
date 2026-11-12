import { config } from '@gallery/core/config';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testArtworkId, testRoomId } from '../../../dev/testView.ts';
import { fakeTeacherServer, teacherView } from '../../../dev/teacherFixtures.ts';
import { flush, mountManage, wait } from '../../../dev/teacherDom.tsx';
import { cardKey, chipKey, dragSensorOptions, KEYBOARD_CODES, resolveDrop, type DropInput } from './dnd.ts';
import { useTeacherStore } from './teacherStore.ts';

const A = (i: number) => testArtworkId(0, i);
const R = (i: number) => testRoomId(i);

describe('끌기 센서 설정(ADR-032)', () => {
  it('마우스는 움직인 거리, 터치는 길게 누르기(지연)로 시작 — 그 전에 움직이면 스크롤로 넘긴다', () => {
    const cfg = config();
    const o = dragSensorOptions();
    expect(o.mouse.activationConstraint).toEqual({ distance: cfg.DRAG_START_PX });
    expect(o.touch.activationConstraint).toEqual({ delay: cfg.LONG_PRESS_MS, tolerance: cfg.DRAG_START_PX });
    expect(o.touch.activationConstraint.delay).toBeGreaterThan(0);
  });

  it('키보드: M으로 집고 Space·Enter로 놓고 Esc로 그만둔다(Space=고르기·Enter=열기와 겹치지 않음)', () => {
    expect(dragSensorOptions().keyboard.keyboardCodes).toBe(KEYBOARD_CODES);
    expect(KEYBOARD_CODES.start).toEqual(['KeyM']);
    expect(KEYBOARD_CODES.start).not.toContain('Space');
    expect(KEYBOARD_CODES.start).not.toContain('Enter');
    expect(KEYBOARD_CODES.end).toEqual(['Space', 'Enter']);
    expect(KEYBOARD_CODES.cancel).toEqual(['Escape']);
  });
});

describe('놓은 결과 → 할 일', () => {
  const base: DropInput = {
    active: cardKey(A(0)),
    over: null,
    distance: 120,
    touch: false,
    roomId: R(0),
    artworkIds: [A(0), A(1), A(2)],
    roomIds: [R(0), R(1)],
    selected: [],
  };

  it('카드 → 다른 카드 자리: 전체 순서', () => {
    expect(resolveDrop({ ...base, over: cardKey(A(2)) })).toEqual({
      kind: 'reorderArtworks',
      roomId: R(0),
      ids: [A(1), A(2), A(0)],
    });
    expect(resolveDrop({ ...base, active: cardKey(A(2)), over: cardKey(A(0)) })?.kind).toBe(
      'reorderArtworks',
    );
    expect(resolveDrop({ ...base, over: cardKey(A(0)) })).toBeNull();
  });

  it('카드 → 다른 전시실 칩: 옮기기(고른 카드를 끌면 고른 것 모두), 지금 전시실 칩이면 아무것도', () => {
    expect(resolveDrop({ ...base, over: chipKey(R(1)) })).toEqual({
      kind: 'moveToRoom',
      roomId: R(1),
      ids: [A(0)],
    });
    expect(resolveDrop({ ...base, over: chipKey(R(1)), selected: [A(0), A(2)] })).toEqual({
      kind: 'moveToRoom',
      roomId: R(1),
      ids: [A(0), A(2)],
    });
    expect(resolveDrop({ ...base, over: chipKey(R(1)), selected: [A(2)] })).toMatchObject({ ids: [A(0)] });
    expect(resolveDrop({ ...base, over: chipKey(R(0)) })).toBeNull();
  });

  it('칩 → 칩: 전시실 순서. 칩을 카드 위에 놓으면 아무것도', () => {
    expect(resolveDrop({ ...base, active: chipKey(R(1)), over: chipKey(R(0)) })).toEqual({
      kind: 'reorderRooms',
      ids: [R(1), R(0)],
    });
    expect(resolveDrop({ ...base, active: chipKey(R(1)), over: cardKey(A(0)) })).toBeNull();
  });

  it('손가락으로 길게 누른 뒤 움직이지 않고 떼면 고르기', () => {
    const still = { ...base, touch: true, distance: config().DRAG_START_PX - 1 };
    expect(resolveDrop({ ...still, over: cardKey(A(0)) })).toEqual({ kind: 'toggleSelect', id: A(0) });
    expect(resolveDrop({ ...still, touch: false, over: cardKey(A(0)) })).toBeNull();
    expect(resolveDrop({ ...still, distance: 200, over: cardKey(A(1)) })?.kind).toBe('reorderArtworks');
  });
});

// ── 실제 센서로 끌기(jsdom에는 배치가 없어 칸 위치를 정해 준다) ─────────────

const CELL_W = 220;
const CELL_H = 280;
const GAP = 20;
const COLS = 3;
const GRID_TOP = 100;
const CHIP_W = 140;
const CHIP_H = 44;

const rectOf = (el: Element): DOMRect => {
  // 손끝을 따라다니는 모양은 처음에 집은 칸 자리에서 시작한다
  if (el.matches('[data-testid="drag-overlay"]') || el.querySelector('[data-testid="drag-overlay"]')) {
    const source = document.querySelector('[data-cell-id][class*="cellDragging"]');
    if (source) return rectOf(source);
  }
  const tid = el.getAttribute('data-testid') ?? '';
  let x = 0;
  let y = 0;
  let w = 0;
  let h = 0;
  const cell = /^cell-(\d+)$/.exec(tid);
  const chip = /^room-chip-(\d+)$/.exec(tid);
  if (cell) {
    const i = Number(cell[1]);
    x = (i % COLS) * (CELL_W + GAP);
    y = GRID_TOP + Math.floor(i / COLS) * (CELL_H + GAP);
    w = CELL_W;
    h = CELL_H;
  } else if (chip) {
    x = Number(chip[1]) * (CHIP_W + GAP);
    w = CHIP_W;
    h = CHIP_H;
  }
  return { x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON: () => ({}) };
};
const centerOf = (el: Element) => {
  const r = rectOf(el);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** 손가락 이벤트(jsdom에는 TouchEvent가 없어 좌표를 붙인 Event로) */
const touch = (el: Element, type: string, at: { x: number; y: number }) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: at.x, clientY: at.y };
  Object.assign(e, { clientX: at.x, clientY: at.y, touches: type === 'touchend' ? [] : [point] });
  Object.assign(e, { changedTouches: [point] });
  act(() => {
    el.dispatchEvent(e);
  });
};

const press = (el: Element, code: string, keyName: string) => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { code, key: keyName, bubbles: true, cancelable: true }));
  });
};

describe('관리 화면에서 실제로 끌기', () => {
  let mounted: ReturnType<typeof mountManage> | null = null;
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rectOf(this);
    });
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.restoreAllMocks();
  });

  const open = async () => {
    const srv = fakeTeacherServer(teacherView());
    mounted = mountManage(srv.api);
    await flush();
    return { srv, m: mounted };
  };
  const ids = (m: ReturnType<typeof mountManage>) => m.all('[data-cell-id]').map(c => c.dataset.cellId);

  it('터치: 길게 누른 뒤 끌어 놓으면 순서를 보낸다(`reorderArtworks`)', async () => {
    const { m, srv } = await open();
    const from = m.q('[data-testid="cell-0"]')!;
    touch(from, 'touchstart', centerOf(from));
    await wait(config().LONG_PRESS_MS + 50);
    const to = centerOf(m.q('[data-testid="cell-2"]')!);
    touch(from, 'touchmove', { x: to.x - 40, y: to.y });
    touch(from, 'touchmove', to);
    expect(m.q('[data-testid="drag-overlay"]')).not.toBeNull();
    touch(from, 'touchend', to);
    await flush();
    expect(srv.named('reorderArtworks').map(c => c.args.slice(1))).toEqual([[R(0), [A(1), A(2), A(0)]]]);
    expect(ids(m)).toEqual([A(1), A(2), A(0)]);
  });

  it('터치: 길게 누르기 전에 움직이면 스크롤로 넘기고 아무것도 보내지 않는다', async () => {
    const { m, srv } = await open();
    const from = m.q('[data-testid="cell-0"]')!;
    const start = centerOf(from);
    touch(from, 'touchstart', start);
    touch(from, 'touchmove', { x: start.x, y: start.y + config().DRAG_START_PX * 4 });
    await wait(config().LONG_PRESS_MS + 50);
    touch(from, 'touchmove', centerOf(m.q('[data-testid="cell-2"]')!));
    touch(from, 'touchend', centerOf(m.q('[data-testid="cell-2"]')!));
    await flush();
    expect(srv.named('reorderArtworks')).toHaveLength(0);
    expect(m.q('[data-testid="drag-overlay"]')).toBeNull();
  });

  it('터치: 길게 누르고 그대로 떼면 여러 장 고르기', async () => {
    const { m, srv } = await open();
    const from = m.q('[data-testid="cell-1"]')!;
    touch(from, 'touchstart', centerOf(from));
    await wait(config().LONG_PRESS_MS + 50);
    touch(from, 'touchend', centerOf(from));
    await flush();
    expect(useTeacherStore.getState().selected).toEqual([A(1)]);
    expect(srv.named('reorderArtworks')).toHaveLength(0);
  });

  it('터치: 카드를 다른 전시실 칩 위에 놓으면 그 전시실로(`patchArtwork` roomId)', async () => {
    const { m, srv } = await open();
    const from = m.q('[data-testid="cell-2"]')!;
    touch(from, 'touchstart', centerOf(from));
    await wait(config().LONG_PRESS_MS + 50);
    const chip = centerOf(m.q('[data-testid="room-chip-1"]')!);
    touch(from, 'touchmove', { x: chip.x, y: chip.y + 60 });
    touch(from, 'touchmove', chip);
    expect(m.q('[data-testid="room-chip-1"]')?.className).toMatch(/chipDrop/);
    touch(from, 'touchend', chip);
    await flush();
    expect(srv.named('patchArtwork').map(c => c.args.slice(1))).toEqual([[A(2), 1, { roomId: R(1) }]]);
    expect(srv.named('batchArtworks')).toHaveLength(0);
    expect(ids(m)).toEqual([A(0), A(1)]);
  });

  it('키보드: M으로 집고 →로 옮긴 뒤 Space로 놓는다(Space가 고르기가 되지 않음)', async () => {
    const { m, srv } = await open();
    const cell = m.q<HTMLElement>('[data-testid="cell-0"]')!;
    act(() => cell.focus());
    press(cell, 'KeyM', 'm');
    await flush();
    press(cell, 'ArrowRight', 'ArrowRight');
    await flush();
    press(cell, 'Space', ' ');
    await flush();
    expect(srv.named('reorderArtworks').map(c => c.args.slice(1))).toEqual([[R(0), [A(1), A(0), A(2)]]]);
    expect(useTeacherStore.getState().selected).toEqual([]);
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
  });

  it('키보드: 맨 윗줄 카드에서 ↑이면 칩 줄, →로 다른 전시실을 골라 Enter로 옮긴다', async () => {
    const { m, srv } = await open();
    const cell = m.q<HTMLElement>('[data-testid="cell-0"]')!;
    act(() => cell.focus());
    press(cell, 'KeyM', 'm');
    await flush();
    press(cell, 'ArrowUp', 'ArrowUp');
    await flush();
    // 바로 위는 지금 전시실 칩(놓아도 그대로) → 옆 칩으로
    expect(m.q('[data-testid="room-chip-0"]')?.className).toMatch(/chipDrop/);
    press(cell, 'ArrowRight', 'ArrowRight');
    await flush();
    expect(m.q('[data-testid="room-chip-0"]')?.className).not.toMatch(/chipDrop/);
    expect(m.q('[data-testid="room-chip-1"]')?.className).toMatch(/chipDrop/);
    press(cell, 'Enter', 'Enter');
    await flush();
    expect(srv.named('patchArtwork').map(c => c.args.slice(1))).toEqual([[A(0), 1, { roomId: R(1) }]]);
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
  });

  it('키보드: 전시실 칩도 M으로 집어 옮긴다(`reorderRooms`), Esc는 그만두기', async () => {
    const { m, srv } = await open();
    const chip = m.q<HTMLElement>('[data-testid="room-chip-0"]')!;
    act(() => chip.focus());
    press(chip, 'KeyM', 'm');
    await flush();
    press(chip, 'ArrowRight', 'ArrowRight');
    await flush();
    press(chip, 'Escape', 'Escape');
    await flush();
    expect(srv.named('reorderRooms')).toHaveLength(0);
    press(chip, 'KeyM', 'm');
    await flush();
    press(chip, 'ArrowRight', 'ArrowRight');
    await flush();
    press(chip, 'Enter', 'Enter');
    await flush();
    expect(srv.named('reorderRooms').map(c => c.args[1])).toEqual([[R(1), R(0)]]);
  });
});
