import { afterEach, describe, expect, it } from 'vitest';
import { overrideConfig, resetConfig } from '../../config.ts';
import {
  extensionOf,
  leadingNumber,
  roomTitleFromFolder,
  stripExtension,
  titleFromName,
} from './titleFromName.ts';

afterEach(() => resetConfig());

describe('titleFromName — 파일 이름 → 작품 제목 (PLAN §5.2)', () => {
  it('PRD 예시: 앞번호·확장자·밑줄을 정리한다', () => {
    expect(titleFromName('03_하늘고래_호외.png')).toBe('하늘고래 호외');
    expect(titleFromName('01_하늘고래.png')).toBe('하늘고래');
  });

  it('앞번호 뒤 구분자(공백·점·밑줄·붙임표)를 함께 지운다', () => {
    expect(titleFromName('1. 우리 동네.jpg')).toBe('우리 동네');
    expect(titleFromName('12-가을 풍경.webp')).toBe('가을 풍경');
    expect(titleFromName('7 _ 별.png')).toBe('별');
  });

  it('구분자 없이 숫자에 붙은 말은 앞번호가 아니다(3학년·5월)', () => {
    expect(titleFromName('3학년_자화상.png')).toBe('3학년 자화상');
    expect(titleFromName('5월의 풍경.png')).toBe('5월의 풍경');
  });

  it('구분자 뒤가 숫자면 지우지 않는다(3.1운동·2.5D·12-3)', () => {
    expect(titleFromName('3.1운동.png')).toBe('3.1운동');
    expect(titleFromName('2.5D 그림.png')).toBe('2.5D 그림');
    expect(titleFromName('12-3 우리집.jpg')).toBe('12 3 우리집');
    // 번호 + 숫자로 시작하는 제목도 같은 까닭으로 번호가 남는다(규칙의 결과)
    expect(titleFromName('02_3.1운동 포스터.png')).toBe('02 3.1운동 포스터');
  });

  it('밑줄·붙임표는 띄어쓰기, 연속 공백은 하나, 앞뒤 공백은 없앤다', () => {
    expect(titleFromName('  가--나__다   라 .jpg')).toBe('가 나 다 라');
  });

  it('앞번호는 맨 앞 한 번만 지운다(가운데 숫자는 남김)', () => {
    expect(titleFromName('하늘고래 2.png')).toBe('하늘고래 2');
    expect(titleFromName('04_하늘_2.png')).toBe('하늘 2');
  });

  it('파일 이름의 네 자리 앞번호는 연도라도 지운다(연도 남기기는 폴더 이름판 규칙)', () => {
    expect(titleFromName('1905_을사늑약.png')).toBe('을사늑약');
  });

  it('숫자뿐인 이름·빈 결과는 빈 문자열(화면이 "제목 없는 작품")', () => {
    expect(titleFromName('01.png')).toBe('');
    expect(titleFromName('2024.jpg')).toBe('');
    expect(titleFromName('___.jpg')).toBe('');
    expect(titleFromName('')).toBe('');
  });

  it('마지막 점 뒤가 영문이 아니면 확장자로 보지 않는다', () => {
    expect(titleFromName('하늘.호외')).toBe('하늘.호외');
    expect(titleFromName('a.b.txt')).toBe('a.b');
  });

  it('풀어 쓴 한글(NFD)은 NFC로 돌려준다', () => {
    const out = titleFromName('03_하늘고래.png'.normalize('NFD'));
    expect(out).toBe('하늘고래');
    expect(out).toBe(out.normalize('NFC'));
  });
});

describe('roomTitleFromFolder — 폴더 이름 → 전시실 이름판', () => {
  it('PRD 예시: 네 자리 연도 + 글자면 앞번호를 남긴다. "을사늑약과 의병" 띄어쓰기는 못 만든다(B4)', () => {
    expect(roomTitleFromFolder('1905_을사늑약과의병')).toBe('1905 을사늑약과의병');
  });

  it('연도 뒤가 숫자면 앞번호가 아니라서 남고, 폴더 이름의 점은 확장자로 떼지 않는다(B3)', () => {
    expect(roomTitleFromFolder('1919_3.1운동')).toBe('1919 3.1운동');
  });

  it('보통 앞번호는 지운다', () => {
    expect(roomTitleFromFolder('02_우리 동네')).toBe('우리 동네');
    expect(roomTitleFromFolder('10-가을')).toBe('가을');
  });

  it('숫자에 붙은 말은 남긴다(3학년·2반)', () => {
    expect(roomTitleFromFolder('3학년_미술')).toBe('3학년 미술');
    expect(roomTitleFromFolder('2반 작품')).toBe('2반 작품');
    expect(roomTitleFromFolder('2024학년도_작품전')).toBe('2024학년도 작품전');
  });

  it('0으로 시작하는 네 자리·다섯 자리 이상은 연도가 아니다', () => {
    expect(roomTitleFromFolder('0001_첫 전시')).toBe('첫 전시');
    expect(roomTitleFromFolder('12345_긴 번호')).toBe('긴 번호');
  });

  it('연도 뒤에 아무것도 없으면 남기지 않아 빈 문자열', () => {
    expect(roomTitleFromFolder('1905')).toBe('');
    expect(roomTitleFromFolder('1905_')).toBe('');
  });

  it('앞번호가 없으면 정리만 한다', () => {
    expect(roomTitleFromFolder('봄_소풍')).toBe('봄 소풍');
  });
});

describe('길이 자르기 (코드 포인트 수, types/text.ts charCount와 같은 셈)', () => {
  it('작품 제목은 ARTWORK_TITLE_MAX_CHARS(60)까지', () => {
    const long = '가'.repeat(70);
    expect(Array.from(titleFromName(`01_${long}.png`))).toHaveLength(60);
    const exact = '나'.repeat(60);
    expect(titleFromName(`${exact}.png`)).toBe(exact);
  });

  it('전시실 이름판은 ROOM_TITLE_MAX_CHARS(30)까지', () => {
    expect(roomTitleFromFolder(`02_${'다'.repeat(40)}`)).toBe('다'.repeat(30));
    expect(roomTitleFromFolder(`1905_${'라'.repeat(40)}`)).toBe(`1905 ${'라'.repeat(25)}`);
  });

  it('자른 끝의 공백은 지운다', () => {
    overrideConfig({ ARTWORK_TITLE_MAX_CHARS: 5, ROOM_TITLE_MAX_CHARS: 3 });
    expect(titleFromName('01_가나다라 마바사.png')).toBe('가나다라');
    expect(roomTitleFromFolder('가나 다라')).toBe('가나');
  });

  it('두 칸짜리 글자(서로게이트 쌍)도 한 글자로 센다', () => {
    overrideConfig({ ARTWORK_TITLE_MAX_CHARS: 3 });
    expect(titleFromName('𝒜𝒜𝒜𝒜.png')).toBe('𝒜𝒜𝒜');
  });

  it('비면 자르기와 상관없이 빈 문자열', () => {
    overrideConfig({ ARTWORK_TITLE_MAX_CHARS: 1, ROOM_TITLE_MAX_CHARS: 1 });
    expect(titleFromName('01.png')).toBe('');
    expect(roomTitleFromFolder('1905')).toBe('');
  });
});

describe('도우미', () => {
  it('leadingNumber: 정렬 키(맨 앞 숫자, 이름판에서 지우는지와 상관없이)', () => {
    expect(leadingNumber('03_하늘고래')).toBe(3);
    expect(leadingNumber('1905_을사늑약과의병')).toBe(1905);
    expect(leadingNumber('1919_3.1운동')).toBe(1919);
    expect(leadingNumber('3학년_미술')).toBe(3);
    expect(leadingNumber('하늘고래 2')).toBeNull();
  });

  it('extensionOf·stripExtension', () => {
    expect(extensionOf('사진.JPG')).toBe('jpg');
    expect(extensionOf('소리.m4a')).toBe('m4a');
    expect(extensionOf('README')).toBeNull();
    expect(extensionOf('.DS_Store')).toBeNull();
    expect(extensionOf('비율 1.5')).toBeNull();
    expect(stripExtension('그림.final.png')).toBe('그림.final');
    expect(stripExtension('.hidden')).toBe('.hidden');
  });
});
