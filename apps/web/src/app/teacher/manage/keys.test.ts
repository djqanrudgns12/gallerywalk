import { describe, expect, it } from 'vitest';
import { cellKeyAction, type KeyLike } from './keys.ts';

const k = (over: Partial<KeyLike>): KeyLike => ({
  key: '',
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe('액자 키(HT-09)', () => {
  it('Enter 살펴보기 · Space 고르기 · ←→ 이웃 · Alt+←→ 한 칸', () => {
    expect(cellKeyAction(k({ key: 'Enter' }))).toBe('open');
    expect(cellKeyAction(k({ key: ' ', code: 'Space' }))).toBe('select');
    expect(cellKeyAction(k({ key: 'ArrowLeft' }))).toBe('prev');
    expect(cellKeyAction(k({ key: 'ArrowRight' }))).toBe('next');
    expect(cellKeyAction(k({ key: 'ArrowLeft', altKey: true }))).toBe('nudgePrev');
    expect(cellKeyAction(k({ key: 'ArrowRight', altKey: true }))).toBe('nudgeNext');
  });

  it('H는 자판 위치로(한글 입력 중 ㅗ도), Delete·Backspace 삭제, ? 도움말', () => {
    expect(cellKeyAction(k({ key: 'h', code: 'KeyH' }))).toBe('toggleHidden');
    expect(cellKeyAction(k({ key: 'ㅗ', code: 'KeyH' }))).toBe('toggleHidden');
    expect(cellKeyAction(k({ key: 'Delete', code: 'Delete' }))).toBe('delete');
    expect(cellKeyAction(k({ key: 'Backspace', code: 'Backspace' }))).toBe('delete');
    expect(cellKeyAction(k({ key: '?', code: 'Slash', shiftKey: true }))).toBe('help');
  });

  it('Ctrl·⌘가 붙으면 브라우저·되돌리기 몫, M(집기)·다른 키는 없음', () => {
    expect(cellKeyAction(k({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBeNull();
    expect(cellKeyAction(k({ key: 'ArrowLeft', metaKey: true }))).toBeNull();
    expect(cellKeyAction(k({ key: 'h', code: 'KeyH', altKey: true }))).toBeNull();
    expect(cellKeyAction(k({ key: 'm', code: 'KeyM' }))).toBeNull();
    expect(cellKeyAction(k({ key: 'x', code: 'KeyX' }))).toBeNull();
  });
});
