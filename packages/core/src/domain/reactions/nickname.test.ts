import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, overrideConfig, resetConfig } from '../../config.ts';
import { normalizeLine } from '../../types/text.ts';
import { prepareNickname } from './nickname.ts';
import * as profanity from './profanity.ts';

afterEach(() => {
  resetConfig();
  vi.restoreAllMocks();
});

describe('prepareNickname', () => {
  it('표시용은 공용 한 줄 정규화와 같고 비교용은 너비·대소문자·공백을 통일한다', () => {
    expect(prepareNickname('  ＡＢＣ\t하늘\r\n  별  ')).toEqual({
      display: 'ＡＢＣ 하늘 별',
      norm: 'abc하늘별',
    });
    expect(prepareNickname('ABC 하늘 별')).toEqual({ display: 'ABC 하늘 별', norm: 'abc하늘별' });
  });

  it('정규화 뒤 빈 글은 empty다', () => {
    for (const raw of ['', '  ', '\t\n\r', '\u3000'])
      expect(prepareNickname(raw)).toEqual({ error: 'empty' });
  });

  it('길이는 공백을 정리한 표시용 코드 포인트로 재며 설정 변경을 즉시 따른다', () => {
    const max = config().NICKNAME_MAX_CHARS;
    expect(prepareNickname('별'.repeat(max))).toEqual({
      display: '별'.repeat(max),
      norm: '별'.repeat(max),
    });
    expect(prepareNickname('별'.repeat(max + 1))).toEqual({ error: 'too_long' });
    overrideConfig({ NICKNAME_MAX_CHARS: 2 });
    expect(prepareNickname('𠮷별')).toEqual({ display: '𠮷별', norm: '𠮷별' });
    expect(prepareNickname('별 별')).toEqual({ error: 'too_long' });
    expect(prepareNickname('  별\n별  ')).toEqual({ error: 'too_long' });
  });

  it('걸러내기 결과를 blocked로 돌려준다(가상 목록으로 실제 정규화 경로 검사)', () => {
    const actualIsBlocked = profanity.isBlocked;
    vi.spyOn(profanity, 'isBlocked').mockImplementation(text => actualIsBlocked(text, ['가짜욕']));
    expect(prepareNickname(' 가.짜1욕 ')).toEqual({ error: 'blocked' });
    expect(prepareNickname('ㄱㅉㅇ')).toEqual({ error: 'blocked' });
    expect(prepareNickname('하늘')).toEqual({ display: '하늘', norm: '하늘' });
  });

  it('정상 글자 조합의 표시 정규화는 공용 규칙과 같고 다시 준비해도 같다', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('하', '늘', '별', 'A', 'Ｂ', ' ', '\t', '\n'), {
          minLength: 1,
          maxLength: 12,
        }),
        chars => {
          const raw = chars.join('');
          const prepared = prepareNickname(raw);
          if ('error' in prepared) {
            expect(prepared).toEqual({ error: 'empty' });
            expect(normalizeLine(raw)).toBe('');
          } else {
            expect(prepared.display).toBe(normalizeLine(raw));
            expect(prepareNickname(prepared.display)).toEqual(prepared);
          }
        },
      ),
      { seed: 20261111, numRuns: 100 },
    );
  });
});
