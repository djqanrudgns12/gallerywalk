import { describe, expect, it } from 'vitest';
import { copy, fill, roAfter } from './ko.ts';

describe('roAfter(으로/로)', () => {
  it('받침 없음·ㄹ 받침은 로, 그 밖의 받침은 으로, 한글이 아니면 (으)로', () => {
    expect(roAfter('하늘고래')).toBe('로');
    expect(roAfter('별빛')).toBe('으로');
    expect(roAfter('하늘')).toBe('로');
    expect(roAfter('Sky7')).toBe('(으)로');
    expect(roAfter('')).toBe('(으)로');
    expect(fill(copy.reaction.asNickname, { nickname: '별빛', ro: roAfter('별빛') })).toBe('별빛으로 남겨요');
  });
});
