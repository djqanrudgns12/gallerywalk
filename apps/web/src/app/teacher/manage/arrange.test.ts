import { describe, expect, it } from 'vitest';
import {
  applyArrangement,
  boardOrder,
  diffArrangement,
  dragOver,
  invertArrangement,
  keyboardTarget,
  locate,
  moveColumn,
  placeCards,
  placeGroup,
  type Columns,
  type KeyBoard,
  type KeyItem,
} from './arrange.ts';

const cols: Columns = [
  { roomId: 'A', ids: ['a1', 'a2', 'a3', 'a4'] },
  { roomId: 'B', ids: ['b1', 'b2'] },
  { roomId: 'C', ids: [] },
];
const ids = (c: Columns) => Object.fromEntries(c.map(x => [x.roomId, x.ids.join(',')]));

describe('placeCards', () => {
  it('같은 판 안에서 자리 옮기기', () => {
    expect(ids(placeCards(cols, ['a1'], { roomId: 'A', index: 2 }))).toMatchObject({ A: 'a2,a3,a1,a4' });
  });

  it('다른 판 n번째로, 원래 판의 빈자리는 닫힌다', () => {
    expect(ids(placeCards(cols, ['a2'], { roomId: 'B', index: 1 }))).toEqual({
      A: 'a1,a3,a4',
      B: 'b1,a2,b2',
      C: '',
    });
  });

  it('빈 판·범위 밖 자리는 끝으로, 없는 판은 그대로', () => {
    expect(ids(placeCards(cols, ['b2'], { roomId: 'C', index: 9 }))).toMatchObject({ B: 'b1', C: 'b2' });
    expect(placeCards(cols, ['a1'], { roomId: 'Z', index: 0 })).toBe(cols);
  });

  it('여러 개는 준 차례대로 붙여 넣는다', () => {
    expect(ids(placeCards(cols, ['a1', 'b2'], { roomId: 'C', index: 0 }))).toEqual({
      A: 'a2,a3,a4',
      B: 'b1',
      C: 'a1,b2',
    });
  });
});

describe('dragOver(끄는 중 임시 배열)', () => {
  it('같은 판: 작품 앞·뒤', () => {
    expect(ids(dragOver(cols, 'a1', { kind: 'card', id: 'a3', after: false }))).toMatchObject({
      A: 'a2,a1,a3,a4',
    });
    expect(ids(dragOver(cols, 'a1', { kind: 'card', id: 'a3', after: true }))).toMatchObject({
      A: 'a2,a3,a1,a4',
    });
  });

  it('다른 판 작품 위 → 그 자리, 판 위 → 끝', () => {
    expect(ids(dragOver(cols, 'a4', { kind: 'card', id: 'b1', after: false }))).toMatchObject({
      A: 'a1,a2,a3',
      B: 'a4,b1,b2',
    });
    expect(ids(dragOver(cols, 'a4', { kind: 'room', roomId: 'C' }))).toMatchObject({ C: 'a4' });
  });

  it('바뀌지 않으면 같은 참조(다시 그리지 않게)', () => {
    expect(dragOver(cols, 'a1', { kind: 'card', id: 'a1', after: true })).toBe(cols);
    expect(dragOver(cols, 'a1', { kind: 'card', id: 'a2', after: false })).toBe(cols);
    expect(dragOver(cols, 'a1', { kind: 'room', roomId: 'A' })).toBe(cols);
    expect(dragOver(cols, 'zz', { kind: 'room', roomId: 'B' })).toBe(cols);
  });
});

describe('placeGroup(여러 개 끌기)', () => {
  it('끈 작품이 놓인 자리부터 보드 차례대로', () => {
    // a3·b1·a1을 골라 a3을 끌어 C에 놓음 → 보드 차례 a1, a3, b1
    const dropped = dragOver(cols, 'a3', { kind: 'room', roomId: 'C' });
    const out = placeGroup(cols, dropped, 'a3', ['a3', 'b1', 'a1']);
    expect(ids(out)).toEqual({ A: 'a2,a4', B: 'b2', C: 'a1,a3,b1' });
  });

  it('같은 판 안에서도', () => {
    const dropped = dragOver(cols, 'a1', { kind: 'card', id: 'a4', after: true });
    expect(ids(placeGroup(cols, dropped, 'a1', ['a1', 'a2']))).toMatchObject({ A: 'a3,a4,a1,a2' });
  });
});

describe('diffArrangement·invertArrangement', () => {
  it('바뀐 판만, 바꾸기 전은 base', () => {
    const after = placeCards(cols, ['a2'], { roomId: 'B', index: 0 });
    const a = diffArrangement(cols, after);
    expect(a).toEqual({
      base: [
        { roomId: 'A', ids: ['a1', 'a2', 'a3', 'a4'] },
        { roomId: 'B', ids: ['b1', 'b2'] },
      ],
      rooms: [
        { roomId: 'A', ids: ['a1', 'a3', 'a4'] },
        { roomId: 'B', ids: ['a2', 'b1', 'b2'] },
      ],
    });
    expect(applyArrangement(cols, a!)).toEqual(after);
    expect(applyArrangement(after, invertArrangement(a!))).toEqual(cols);
  });

  it('판이 비면 빈 배열로 보낸다', () => {
    const after = placeCards(cols, ['b1', 'b2'], { roomId: 'C', index: 0 });
    expect(diffArrangement(cols, after)?.rooms).toContainEqual({ roomId: 'B', ids: [] });
  });

  it('같으면 null', () => {
    expect(diffArrangement(cols, cols)).toBeNull();
  });
});

describe('작은 도우미', () => {
  it('locate·boardOrder·moveColumn', () => {
    expect(locate(cols, 'b2')).toEqual({ roomId: 'B', index: 1 });
    expect(locate(cols, 'zz')).toBeNull();
    expect(boardOrder(cols, ['b1', 'a3', 'zz', 'a1'])).toEqual(['a1', 'a3', 'b1']);
    expect(moveColumn(['A', 'B', 'C'], 'A', 'C')).toEqual(['B', 'C', 'A']);
    expect(moveColumn(['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'A', 'B']);
    expect(moveColumn(['A', 'B'], 'A', 'A')).toBeNull();
  });
});

describe('keyboardTarget(키보드로 다음 자리)', () => {
  // 판 A: 두 줄(a1 a2 a3 / a4), 판 B: 한 줄(b1 b2), 판 C: 비었음. 폭이 다른 액자
  const r = (left: number, top: number, width = 80, height = 92) => ({ left, top, width, height });
  const items: KeyItem[] = [
    { id: 'a1', roomId: 'A', rect: r(0, 0, 60) },
    { id: 'a2', roomId: 'A', rect: r(70, 0, 120) },
    { id: 'a3', roomId: 'A', rect: r(200, 4, 80) },
    { id: 'a4', roomId: 'A', rect: r(0, 110, 100) },
    { id: 'b1', roomId: 'B', rect: r(0, 300) },
    { id: 'b2', roomId: 'B', rect: r(150, 300) },
  ];
  const boards: KeyBoard[] = [
    { roomId: 'B', rect: r(0, 280, 900, 140) },
    { roomId: 'A', rect: r(0, -20, 900, 260) },
    { roomId: 'C', rect: r(0, 440, 900, 120) },
  ];

  it('←→는 판 안 읽는 차례로 한 칸, 끝에서는 없음', () => {
    expect(keyboardTarget(items, boards, 'a3', 'right')).toEqual({ kind: 'card', id: 'a4', after: true });
    expect(keyboardTarget(items, boards, 'a2', 'left')).toEqual({ kind: 'card', id: 'a1', after: false });
    expect(keyboardTarget(items, boards, 'a1', 'left')).toBeNull();
    expect(keyboardTarget(items, boards, 'b2', 'right')).toBeNull();
  });

  it('↑↓는 판 안 위·아래 줄의 가까운 자리', () => {
    // a4의 가운데(x 50)는 a1 가운데(30)보다 오른쪽 → a1 뒤
    expect(keyboardTarget(items, boards, 'a4', 'up')).toEqual({ kind: 'card', id: 'a1', after: true });
    expect(keyboardTarget(items, boards, 'a2', 'down')).toEqual({ kind: 'card', id: 'a4', after: true });
  });

  it('끝 줄에서 ↓는 아래 판, 첫 줄에서 ↑는 위 판, 빈 판이면 판 자체', () => {
    expect(keyboardTarget(items, boards, 'a4', 'down')).toEqual({ kind: 'card', id: 'b1', after: true });
    expect(keyboardTarget(items, boards, 'a1', 'down')).toEqual({ kind: 'card', id: 'a4', after: false });
    expect(keyboardTarget(items, boards, 'b2', 'up')).toEqual({ kind: 'card', id: 'a4', after: true });
    expect(keyboardTarget(items, boards, 'b1', 'down')).toEqual({ kind: 'room', roomId: 'C' });
    expect(keyboardTarget(items, boards, 'a1', 'up')).toBeNull();
  });
});
