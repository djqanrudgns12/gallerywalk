import { afterEach, describe, expect, it } from 'vitest';
import { overrideConfig, resetConfig } from '../../config.ts';
import { guessTextHeavy, nameSuggestsText, type TextHeavyInput } from './textHeavy.ts';

const picture = (patch: Partial<TextHeavyInput> = {}): TextHeavyInput => ({
  kind: 'IMAGE',
  form: 'LANDSCAPE',
  fileName: '03_하늘고래.png',
  linePitchPx: null,
  ...patch,
});

afterEach(() => resetConfig());

describe('guessTextHeavy', () => {
  it('보통 그림은 끈다', () => {
    expect(guessTextHeavy(picture())).toBe(false);
    expect(guessTextHeavy(picture({ form: 'PORTRAIT' }))).toBe(false);
  });

  it('PDF·글 카드·긴 세로는 켠다', () => {
    expect(guessTextHeavy(picture({ kind: 'PDF', form: 'MULTIPAGE', fileName: '발표.pdf' }))).toBe(true);
    expect(guessTextHeavy(picture({ kind: 'TEXT', form: 'TEXTCARD', fileName: '시.txt' }))).toBe(true);
    expect(guessTextHeavy(picture({ form: 'TALL' }))).toBe(true);
  });

  it('이름 낱말 일곱 개 모두 켠다', () => {
    for (const word of ['기사', '포스터', '웹툰', '만화', '신문', '카드뉴스', '보고서']) {
      expect(guessTextHeavy(picture({ fileName: `05_우리반_${word}.jpg` }))).toBe(true);
    }
  });

  it('macOS에서 온 풀어 쓴 한글(NFD) 이름도 알아본다', () => {
    const nfd = '02_학급신문.png'.normalize('NFD');
    expect(nfd).not.toBe('02_학급신문.png');
    expect(guessTextHeavy(picture({ fileName: nfd }))).toBe(true);
  });

  it('서버가 글 줄 간격을 찾았으면 켠다', () => {
    expect(guessTextHeavy(picture({ linePitchPx: 42 }))).toBe(true);
  });

  it('소리는 이름에 낱말이 있어도 끈다', () => {
    expect(
      guessTextHeavy({ kind: 'AUDIO', form: 'SOUND', fileName: '신문기사 낭독.mp3', linePitchPx: null }),
    ).toBe(false);
  });

  it('낱말 목록은 설정 키를 따른다', () => {
    overrideConfig({ TEXT_HEAVY_NAME_WORDS: ['Poster'] });
    expect(nameSuggestsText('school_POSTER.png')).toBe(true);
    expect(nameSuggestsText('웹툰.png')).toBe(false);
  });
});
