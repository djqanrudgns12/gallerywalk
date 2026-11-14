import { config } from '@gallery/core/config';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testArtworkId, testRoomId } from '../../../dev/testView.ts';
import { fakeTeacherServer, teacherRoom, teacherView } from '../../../dev/teacherFixtures.ts';
import { flush, mountManage, wait } from '../../../dev/teacherDom.tsx';
import { boardKey, cardKey, dragSensorOptions, isAfter, KEYBOARD_CODES, parseKey, roomKey } from './dnd.ts';
import { useTeacherStore } from './teacherStore.ts';

const A = (r: number, i: number) => testArtworkId(r, i);
const R = (i: number) => testRoomId(i);

describe('끌기 키와 센서(ADR-032·074)', () => {
  it('마우스는 움직인 거리, 터치는 길게 누르기(지연)로 시작 — 그 전에 움직이면 스크롤로 넘긴다', () => {
    const cfg = config();
    const o = dragSensorOptions();
    expect(o.mouse.activationConstraint).toEqual({ distance: cfg.DRAG_START_PX });
    expect(o.touch.activationConstraint).toEqual({ delay: cfg.LONG_PRESS_MS, tolerance: cfg.DRAG_START_PX });
  });

  it('키보드: M으로 집고 Space·Enter로 놓고 Esc로 그만둔다', () => {
    expect(dragSensorOptions().keyboard.keyboardCodes).toBe(KEYBOARD_CODES);
    expect(KEYBOARD_CODES).toEqual({ start: ['KeyM'], cancel: ['Escape'], end: ['Space', 'Enter'] });
  });

  it('키 세 갈래(액자·판·판 머리)를 되읽는다', () => {
    expect(parseKey(cardKey('x'))).toEqual({ kind: 'card', id: 'x' });
    expect(parseKey(roomKey('y'))).toEqual({ kind: 'room', id: 'y' });
    expect(parseKey(boardKey('z'))).toEqual({ kind: 'board', id: 'z' });
    expect(parseKey('chip:z')).toBeNull();
    expect(parseKey(null)).toBeNull();
  });

  it('놓일 액자 앞·뒤: 같은 줄이면 가로 가운데, 다른 줄이면 세로 가운데', () => {
    const rect = { left: 100, top: 100, width: 80, height: 90 };
    expect(isAfter({ x: 150, y: 140 }, rect)).toBe(true);
    expect(isAfter({ x: 120, y: 140 }, rect)).toBe(false);
    expect(isAfter({ x: 10, y: 260 }, rect)).toBe(true);
    expect(isAfter({ x: 400, y: 20 }, rect)).toBe(false);
  });
});

// ── 실제 센서로 끌기(jsdom에는 배치가 없어 판·액자 자리를 DOM 차례로 정해 준다) ─────────────
// 판 i: 위 = i × BOARD_H, 머리 HEAD 아래로 액자가 COLS개씩 줄을 이룬다(폭 W·높이 H·사이 GAP)

const W = 100;
const H = 92;
const GAP = 20;
const COLS = 4;
const HEAD = 60;
const BOARD_H = 400;
const BOARD_W = COLS * (W + GAP);

const boardsInDom = () => Array.from(document.querySelectorAll('[data-testid^="room-board-"]'));

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  }) as DOMRect;

const rectOf = (el: Element): DOMRect => {
  // 손끝을 따라다니는 모양은 처음에 집은 자리에서 시작한다
  if (el.closest('[data-testid="drag-overlay"]') || el.querySelector('[data-testid="drag-overlay"]')) {
    const source = document.querySelector('[data-frame][data-lifted="true"]')?.closest('[data-cell-id]');
    if (source) return rectOf(source);
  }
  const section = el.closest('[data-testid^="room-board-"]');
  const b = section ? boardsInDom().indexOf(section) : -1;
  if (b < 0) return rect(0, 0, 0, 0);
  const top = b * BOARD_H;
  const cell = el.closest('[data-cell-id]');
  if (cell) {
    const i = Array.from(section!.querySelectorAll('[data-cell-id]')).indexOf(cell);
    return rect((i % COLS) * (W + GAP), top + HEAD + Math.floor(i / COLS) * (H + GAP), W, H);
  }
  if (el.matches('[data-testid^="room-wall-"]')) return rect(0, top + HEAD, BOARD_W, BOARD_H - HEAD - GAP);
  if (el === section) return rect(0, top, BOARD_W, BOARD_H - GAP);
  return rect(0, top, BOARD_W, HEAD);
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

const mouse = (el: Element | Document, type: string, at: { x: number; y: number }) => {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0 }),
    );
  });
};

const press = (el: Element, code: string, keyName: string) => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { code, key: keyName, bubbles: true, cancelable: true }));
  });
};

describe('관리 화면 v3 보드에서 실제로 끌기', () => {
  let mounted: ReturnType<typeof mountManage> | null = null;
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rectOf(this);
    });
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    useTeacherStore.getState().reset();
    vi.restoreAllMocks();
  });

  /** 판 셋: 첫 판 작품 3, 둘째 2, 셋째 빈 판 */
  const open = async () => {
    const view = teacherView([3, 2]);
    view.rooms = [teacherRoom(0), teacherRoom(1), teacherRoom(2)];
    const srv = fakeTeacherServer(view);
    mounted = mountManage(srv.api);
    await flush();
    return { srv, m: mounted };
  };
  const cell = (m: ReturnType<typeof mountManage>, id: string) => m.q(`[data-cell-id="${id}"]`)!;
  const wall = (m: ReturnType<typeof mountManage>, r: number) =>
    m.all(`[data-testid="room-wall-${R(r)}"] [data-cell-id]`).map(c => c.dataset.cellId);

  it('보드는 모든 전시실 판을 그리고, 판마다 번호·작품 수', async () => {
    const { m } = await open();
    expect(m.all('[data-testid^="room-board-"]')).toHaveLength(3);
    expect(wall(m, 0)).toEqual([A(0, 0), A(0, 1), A(0, 2)]);
    expect(wall(m, 1)).toEqual([A(1, 0), A(1, 1)]);
    expect(wall(m, 2)).toEqual([]);
  });

  it('마우스: 같은 판 안 순서 — 요청 하나(arrangement)', async () => {
    const { m, srv } = await open();
    const from = cell(m, A(0, 0));
    const a = centerOf(from);
    mouse(from, 'mousedown', a);
    const to = centerOf(cell(m, A(0, 2)));
    mouse(document, 'mousemove', { x: a.x + 20, y: a.y });
    mouse(document, 'mousemove', { x: to.x + W / 4, y: to.y });
    await flush();
    expect(m.q('[data-testid="drag-overlay"]')).not.toBeNull();
    mouse(document, 'mouseup', { x: to.x + W / 4, y: to.y });
    await flush();
    expect(srv.arranged()).toEqual([[{ roomId: R(0), ids: [A(0, 1), A(0, 2), A(0, 0)] }]]);
    expect(wall(m, 0)).toEqual([A(0, 1), A(0, 2), A(0, 0)]);
  });

  it('마우스: 끝 액자에 왼쪽으로 들어간 뒤 같은 액자의 오른쪽 절반으로 가면 판 끝에 놓인다(검토 H2a)', async () => {
    const { m, srv } = await open();
    const from = cell(m, A(0, 0));
    const a = centerOf(from);
    mouse(from, 'mousedown', a);
    mouse(document, 'mousemove', { x: a.x + 20, y: a.y });
    const left = centerOf(cell(m, A(0, 2)));
    mouse(document, 'mousemove', { x: left.x - W / 4, y: left.y });
    await flush();
    expect(wall(m, 0)).toEqual([A(0, 1), A(0, 0), A(0, 2)]);
    // 같은 액자(끝 작품) 위에서 오른쪽 절반으로 — 놓일 곳 ID는 그대로라 onDragMove가 잡는다
    const right = centerOf(cell(m, A(0, 2)));
    mouse(document, 'mousemove', { x: right.x + W / 4, y: right.y });
    await flush();
    expect(wall(m, 0)).toEqual([A(0, 1), A(0, 2), A(0, 0)]);
    mouse(document, 'mouseup', { x: right.x + W / 4, y: right.y });
    await flush();
    expect(srv.arranged()).toEqual([[{ roomId: R(0), ids: [A(0, 1), A(0, 2), A(0, 0)] }]]);
  });

  it('마우스: 다른 판 n번째 — 놓일 판에 안내, 두 판을 한 요청으로', async () => {
    const { m, srv } = await open();
    const from = cell(m, A(0, 2));
    const a = centerOf(from);
    mouse(from, 'mousedown', a);
    const to = centerOf(cell(m, A(1, 1)));
    mouse(document, 'mousemove', { x: a.x, y: a.y + 30 });
    mouse(document, 'mousemove', { x: to.x - W / 4, y: to.y });
    await flush();
    expect(m.q(`[data-testid="room-board-${R(1)}"] [data-testid="drop-hint"]`)).not.toBeNull();
    mouse(document, 'mouseup', { x: to.x - W / 4, y: to.y });
    await flush();
    expect(srv.arranged()).toEqual([
      [
        { roomId: R(0), ids: [A(0, 0), A(0, 1)] },
        { roomId: R(1), ids: [A(1, 0), A(0, 2), A(1, 1)] },
      ],
    ]);
  });

  it('터치: 길게 누른 뒤 빈 판에 놓으면 그 판 끝', async () => {
    const { m, srv } = await open();
    const from = cell(m, A(1, 0));
    touch(from, 'touchstart', centerOf(from));
    await wait(config().LONG_PRESS_MS + 50);
    const empty = centerOf(m.q(`[data-testid="room-wall-${R(2)}"]`)!);
    touch(from, 'touchmove', { x: empty.x, y: empty.y - 40 });
    touch(from, 'touchmove', empty);
    touch(from, 'touchend', empty);
    await flush();
    expect(srv.arranged()).toEqual([
      [
        { roomId: R(1), ids: [A(1, 1)] },
        { roomId: R(2), ids: [A(1, 0)] },
      ],
    ]);
  });

  it('터치: 길게 누르기 전에 움직이면 스크롤로 넘기고, 길게 누르고 그대로 떼면 고르기', async () => {
    const { m, srv } = await open();
    const from = cell(m, A(0, 0));
    const start = centerOf(from);
    touch(from, 'touchstart', start);
    touch(from, 'touchmove', { x: start.x, y: start.y + config().DRAG_START_PX * 4 });
    await wait(config().LONG_PRESS_MS + 50);
    touch(from, 'touchend', centerOf(cell(m, A(0, 2))));
    await flush();
    expect(srv.named('putArrangement')).toHaveLength(0);

    const other = cell(m, A(0, 1));
    touch(other, 'touchstart', centerOf(other));
    await wait(config().LONG_PRESS_MS + 50);
    touch(other, 'touchend', centerOf(other));
    await flush();
    expect(useTeacherStore.getState().selected).toEqual([A(0, 1)]);
    expect(srv.named('putArrangement')).toHaveLength(0);
  });

  it('키보드: M으로 집고 →→로 옮긴 뒤 Space로 놓는다(Space가 고르기가 되지 않음), 초점은 옮긴 액자', async () => {
    const { m, srv } = await open();
    const c = cell(m, A(0, 0));
    act(() => c.focus());
    press(c, 'KeyM', 'm');
    await flush();
    press(c, 'ArrowRight', 'ArrowRight');
    await flush();
    press(c, 'ArrowRight', 'ArrowRight');
    await flush();
    press(c, 'Space', ' ');
    await flush();
    await wait(30);
    expect(srv.arranged()).toEqual([[{ roomId: R(0), ids: [A(0, 1), A(0, 2), A(0, 0)] }]]);
    expect(useTeacherStore.getState().selected).toEqual([]);
    expect(document.activeElement?.getAttribute('data-cell-id')).toBe(A(0, 0));
  });

  it('키보드: 판의 끝 줄에서 ↓이면 아래 판, Enter로 놓는다', async () => {
    const { m, srv } = await open();
    const c = cell(m, A(0, 0));
    act(() => c.focus());
    press(c, 'KeyM', 'm');
    await flush();
    press(c, 'ArrowDown', 'ArrowDown');
    await flush();
    // 다른 판으로 가며 액자가 새로 만들어졌다 — 키는 창(끌기 센서)으로 간다
    expect(c.isConnected).toBe(false);
    press(cell(m, A(0, 0)), 'Enter', 'Enter');
    await flush();
    expect(srv.arranged()).toEqual([
      [
        { roomId: R(0), ids: [A(0, 1), A(0, 2)] },
        { roomId: R(1), ids: [A(0, 0), A(1, 0), A(1, 1)] },
      ],
    ]);
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
  });

  it('키보드: Esc는 그만두기 — 아무것도 보내지 않고 제자리', async () => {
    const { m, srv } = await open();
    const c = cell(m, A(0, 0));
    act(() => c.focus());
    press(c, 'KeyM', 'm');
    await flush();
    press(c, 'ArrowRight', 'ArrowRight');
    await flush();
    press(c, 'Escape', 'Escape');
    await flush();
    expect(srv.named('putArrangement')).toHaveLength(0);
    expect(wall(m, 0)).toEqual([A(0, 0), A(0, 1), A(0, 2)]);
  });

  it('판 순서: 손잡이를 M으로 집어 ↓ 뒤 Space(바꾸기 전 순서를 함께 보냄)', async () => {
    const { m, srv } = await open();
    const handle = m.q<HTMLElement>(`[data-testid="board-handle-${R(0)}"]`)!;
    act(() => handle.focus());
    press(handle, 'KeyM', 'm');
    await flush();
    press(handle, 'ArrowDown', 'ArrowDown');
    await flush();
    press(handle, 'Space', ' ');
    await flush();
    expect(srv.named('reorderRooms')[0]?.args.slice(1)).toEqual([
      [R(1), R(0), R(2)],
      [R(0), R(1), R(2)],
    ]);
  });

  it('여러 개 끌기: 고른 둘 중 하나를 다른 판에 놓으면 놓인 자리부터 보드 차례대로', async () => {
    const { m, srv } = await open();
    useTeacherStore.getState().toggleSelect(A(0, 2));
    useTeacherStore.getState().toggleSelect(A(0, 0));
    await flush();
    const from = cell(m, A(0, 2));
    const a = centerOf(from);
    mouse(from, 'mousedown', a);
    const to = centerOf(cell(m, A(1, 0)));
    mouse(document, 'mousemove', { x: a.x, y: a.y + 30 });
    mouse(document, 'mousemove', { x: to.x + W / 4, y: to.y });
    await flush();
    expect(m.q('[data-testid="drag-overlay"]')?.textContent).toContain('2');
    mouse(document, 'mouseup', { x: to.x + W / 4, y: to.y });
    await flush();
    expect(srv.arranged()).toEqual([
      [
        { roomId: R(0), ids: [A(0, 1)] },
        { roomId: R(1), ids: [A(1, 0), A(0, 0), A(0, 2), A(1, 1)] },
      ],
    ]);
  });
});
