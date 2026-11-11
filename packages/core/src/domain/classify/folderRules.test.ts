import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fileKindFromName,
  groupUpload,
  isIgnoredFileName,
  type RoomBundle,
  type UploadEntry,
} from './folderRules.ts';

const files = (...paths: string[]): UploadEntry[] => paths.map((path, i) => ({ path, size: 1000 + i }));

/** 묶음을 보기 쉬운 모양으로: 이름판 → 작품 경로들, 배경음악 경로 */
const view = (rooms: readonly RoomBundle[]) =>
  rooms.map(r => ({
    source: r.source,
    title: r.title,
    works: r.works.map(w => w.path),
    bgm: r.bgm?.path ?? null,
  }));

describe('fileKindFromName', () => {
  it('확장자로 종류를 가른다(대소문자 무시)', () => {
    expect(fileKindFromName('a.PNG')).toBe('IMAGE');
    expect(fileKindFromName('a.jpeg')).toBe('IMAGE');
    expect(fileKindFromName('a.heic')).toBe('IMAGE');
    expect(fileKindFromName('a.gif')).toBe('IMAGE');
    expect(fileKindFromName('발표.pdf')).toBe('PDF');
    expect(fileKindFromName('시.txt')).toBe('TEXT');
    expect(fileKindFromName('곡.mp3')).toBe('AUDIO');
    expect(fileKindFromName('녹음.M4A')).toBe('AUDIO');
    expect(fileKindFromName('소리.wav')).toBe('AUDIO');
    expect(fileKindFromName('영상.mov')).toBe('VIDEO');
    expect(fileKindFromName('영상.mp4')).toBe('VIDEO');
    expect(fileKindFromName('그림.svg')).toBe('OTHER');
    expect(fileKindFromName('문서.docx')).toBe('OTHER');
    expect(fileKindFromName('이름없음')).toBe('OTHER');
  });
});

describe('isIgnoredFileName', () => {
  it('숨김·시스템 파일', () => {
    for (const name of [
      '.DS_Store',
      '._하늘.png',
      'Thumbs.db',
      'THUMBS.DB',
      'desktop.ini',
      'Desktop.ini',
      'Icon\r',
    ]) {
      expect(isIgnoredFileName(name)).toBe(true);
    }
    for (const name of ['하늘.png', 'thumbs.png', 'desktop.ini.txt']) {
      expect(isIgnoredFileName(name)).toBe(false);
    }
  });
});

describe('groupUpload — 전시실 나누기 (PLAN §5.2)', () => {
  it('맨 위 폴더 하나 + 하위 폴더 → 하위 폴더마다 전시실, 자연 정렬, 이름판 정리', () => {
    const plan = groupUpload(
      files(
        '우리반/10_가을/01_낙엽.png',
        '우리반/2_여름/02_바다.jpg',
        '우리반/2_여름/01_해바라기.png',
        '우리반/1905_을사늑약과의병/03_하늘고래_호외.png',
      ),
      '지금 전시실',
    );
    expect(view(plan.rooms)).toEqual([
      {
        source: 'FOLDER',
        title: '여름',
        works: ['우리반/2_여름/01_해바라기.png', '우리반/2_여름/02_바다.jpg'],
        bgm: null,
      },
      { source: 'FOLDER', title: '가을', works: ['우리반/10_가을/01_낙엽.png'], bgm: null },
      {
        source: 'FOLDER',
        title: '1905 을사늑약과의병',
        works: ['우리반/1905_을사늑약과의병/03_하늘고래_호외.png'],
        bgm: null,
      },
    ]);
    expect(plan.rooms.map(r => [r.folderName, r.sortNumber])).toEqual([
      ['2_여름', 2],
      ['10_가을', 10],
      ['1905_을사늑약과의병', 1905],
    ]);
    expect(plan.rooms[2]!.works[0]!.title).toBe('하늘고래 호외');
    expect(plan.dropped).toEqual([]);
  });

  it('맨 위 폴더 하나 + 하위 폴더 없음 → 그 폴더가 전시실 하나', () => {
    const plan = groupUpload(files('봄_소풍/2.png', '봄_소풍/10.png', '봄_소풍/1.png'), null);
    expect(view(plan.rooms)).toEqual([
      {
        source: 'FOLDER',
        title: '봄 소풍',
        works: ['봄_소풍/1.png', '봄_소풍/2.png', '봄_소풍/10.png'],
        bgm: null,
      },
    ]);
  });

  it('파일만 올리면 지금 전시실, 지금 전시실이 없으면 이름 null', () => {
    const entries = files('02_별.png', '01_달.png');
    expect(view(groupUpload(entries, '3반 그림').rooms)).toEqual([
      { source: 'CURRENT', title: '3반 그림', works: ['01_달.png', '02_별.png'], bgm: null },
    ]);
    const none = groupUpload(entries, null).rooms[0]!;
    expect(none.title).toBeNull();
    expect(none.folderName).toBeNull();
    expect(none.sortNumber).toBeNull();
  });

  it('2단계보다 깊은 폴더는 가장 가까운 전시실 폴더에 합친다', () => {
    const plan = groupUpload(
      files(
        '전시/가_방/1.png',
        '전시/가_방/스케치/2.png',
        '전시/가_방/스케치/더깊이/3.png',
        '전시/나_방/1.png',
      ),
      null,
    );
    expect(view(plan.rooms)).toEqual([
      {
        source: 'FOLDER',
        title: '가 방',
        works: ['전시/가_방/1.png', '전시/가_방/스케치/2.png', '전시/가_방/스케치/더깊이/3.png'],
        bgm: null,
      },
      { source: 'FOLDER', title: '나 방', works: ['전시/나_방/1.png'], bgm: null },
    ]);
  });

  it('맨 위 폴더 바로 안의 파일은 맨 위 폴더 이름의 전시실로, 하위 전시실보다 앞에', () => {
    const plan = groupUpload(files('우리반/표지.png', '우리반/1_봄/a.png'), null);
    expect(view(plan.rooms).map(r => [r.title, r.works])).toEqual([
      ['우리반', ['우리반/표지.png']],
      ['봄', ['우리반/1_봄/a.png']],
    ]);
  });

  it('폴더 여러 개를 함께 놓으면 맨 위 폴더 하나 = 전시실 하나(그 아래는 합침)', () => {
    const plan = groupUpload(files('2_나비/a.png', '10_벌/b.png', '2_나비/참고/c.png'), null);
    // 한국어 정렬은 한글을 영문보다 앞에 둔다(`참고` < `a.png`).
    expect(view(plan.rooms)).toEqual([
      { source: 'FOLDER', title: '나비', works: ['2_나비/참고/c.png', '2_나비/a.png'], bgm: null },
      { source: 'FOLDER', title: '벌', works: ['10_벌/b.png'], bgm: null },
    ]);
  });

  it('폴더와 낱개 파일을 섞어 놓으면 낱개 파일은 지금 전시실, 폴더는 폴더 규칙', () => {
    const plan = groupUpload(files('낱개.png', '우리반/1_봄/a.png', '우리반/2_여름/b.png'), '지금');
    expect(view(plan.rooms).map(r => [r.source, r.title])).toEqual([
      ['CURRENT', '지금'],
      ['FOLDER', '봄'],
      ['FOLDER', '여름'],
    ]);
  });

  it('webkitGetAsEntry의 앞 `/`·빈 조각·`.` 조각은 무시하고 NFC로 맞춘다', () => {
    const plan = groupUpload(
      [
        { path: '/우리반/봄//a.png', size: 1 },
        { path: './우리반/봄/b.png', size: 2 },
        { path: '우리반/봄/c.png'.normalize('NFD'), size: 3 },
      ],
      null,
    );
    expect(view(plan.rooms)).toEqual([
      {
        source: 'FOLDER',
        title: '봄',
        works: ['우리반/봄/a.png', '우리반/봄/b.png', '우리반/봄/c.png'],
        bgm: null,
      },
    ]);
  });
});

describe('groupUpload — 버리는 파일', () => {
  it('.DS_Store · ._x · Thumbs.db · desktop.ini · 숨김 폴더 · __MACOSX는 조용히 버린다', () => {
    const entries = files(
      '우리반/봄/.DS_Store',
      '우리반/봄/._a.png',
      '우리반/봄/Thumbs.db',
      '우리반/봄/desktop.ini',
      '우리반/.git/config.png',
      '__MACOSX/우리반/봄/._a.png',
      '우리반/봄/a.png',
    );
    const plan = groupUpload(entries, null);
    expect(view(plan.rooms)).toEqual([
      { source: 'FOLDER', title: '봄', works: ['우리반/봄/a.png'], bgm: null },
    ]);
    expect(plan.dropped.map(e => e.path).sort()).toEqual(
      entries
        .slice(0, 6)
        .map(e => e.path)
        .sort(),
    );
  });

  it('버린 파일만 있던 폴더는 전시실이 되지 않고, 구조 판단에도 끼지 않는다', () => {
    // `빈방`에 .DS_Store만 있으면 하위 폴더가 없는 것으로 보고 `우리반` 자체가 전시실이다.
    const plan = groupUpload(files('우리반/빈방/.DS_Store', '우리반/a.png'), null);
    expect(view(plan.rooms)).toEqual([
      { source: 'FOLDER', title: '우리반', works: ['우리반/a.png'], bgm: null },
    ]);
  });

  it('빈 경로도 버린다', () => {
    expect(groupUpload(files('', '/'), null)).toEqual({ rooms: [], dropped: files('', '/') });
  });
});

describe('groupUpload — 소리', () => {
  it('폴더 전시실의 소리가 하나면 배경음악', () => {
    const plan = groupUpload(files('우리반/봄/a.png', '우리반/봄/봄노래.mp3'), null);
    expect(view(plan.rooms)).toEqual([
      { source: 'FOLDER', title: '봄', works: ['우리반/봄/a.png'], bgm: '우리반/봄/봄노래.mp3' },
    ]);
  });

  it('여럿이면 이름순(자연 정렬) 첫째가 배경음악, 나머지는 소리 작품으로 작품 순서에 남는다', () => {
    const plan = groupUpload(
      files('봄/10_바람.m4a', '봄/2_새소리.mp3', '봄/1_그림.png', '봄/3_빗소리.wav'),
      null,
    );
    const room = plan.rooms[0]!;
    expect(room.bgm?.path).toBe('봄/2_새소리.mp3');
    expect(room.works.map(w => [w.path, w.kind])).toEqual([
      ['봄/1_그림.png', 'IMAGE'],
      ['봄/3_빗소리.wav', 'AUDIO'],
      ['봄/10_바람.m4a', 'AUDIO'],
    ]);
  });

  it('폴더 없는 파일의 소리는 배경음악으로 잡지 않는다(지금 전시실의 곡을 덮지 않음)', () => {
    const room = groupUpload(files('곡.mp3', 'a.png'), '지금').rooms[0]!;
    expect(room.bgm).toBeNull();
    expect(room.works.map(w => [w.fileName, w.kind])).toEqual([
      ['곡.mp3', 'AUDIO'],
      ['a.png', 'IMAGE'],
    ]);
  });

  it('영상·받지 않는 형식은 버리지 않고 종류를 표시해 묶음에 넣는다(화면이 안내)', () => {
    const room = groupUpload(files('봄/영상.mp4', '봄/그림.svg', '봄/a.png'), null).rooms[0]!;
    expect(room.works.map(w => [w.fileName, w.kind])).toEqual([
      ['그림.svg', 'OTHER'],
      ['영상.mp4', 'VIDEO'],
      ['a.png', 'IMAGE'],
    ]);
  });
});

describe('groupUpload — 결정성·빠짐없음 (속성 시험)', () => {
  const pool = [
    '우리반/2_여름/01_해바라기.png',
    '우리반/2_여름/02_바다.jpg',
    '우리반/2_여름/여름노래.mp3',
    '우리반/2_여름/1_매미.mp3',
    '우리반/10_가을/01_낙엽.png',
    '우리반/10_가을/스케치/깊이/1.png',
    '우리반/10_가을/.DS_Store',
    '우리반/1905_을사늑약과의병/03_하늘고래_호외.png',
    '우리반/표지.png',
    '우리반/Thumbs.db',
    '다른반/a.png',
    '다른반/b/c.png',
    '낱개_10.png',
    '낱개_2.png',
    '낱개곡.mp3',
    '._낱개.png',
    '영상.mov',
  ];
  const entries = fc.uniqueArray(fc.constantFrom(...pool), { maxLength: pool.length }).chain(paths => {
    const es = paths.map((path, i) => ({ path, size: i }));
    return fc.tuple(fc.constant(es), fc.shuffledSubarray(es, { minLength: es.length, maxLength: es.length }));
  });

  it('입력 순서를 섞어도 같은 결과', () => {
    fc.assert(
      fc.property(entries, fc.constantFrom<string | null>(null, '지금'), ([es, shuffled], current) => {
        expect(groupUpload(shuffled, current)).toEqual(groupUpload(es, current));
      }),
      { seed: 20261111, numRuns: 500 },
    );
  });

  it('모든 항목이 정확히 한 번(작품·배경음악·버림 중 하나)', () => {
    fc.assert(
      fc.property(entries, ([es]) => {
        const plan = groupUpload(es, null);
        const placed = [
          ...plan.rooms.flatMap(r => [
            ...r.works.map(w => w.entry),
            ...(r.bgm === null ? [] : [r.bgm.entry]),
          ]),
          ...plan.dropped,
        ];
        expect(placed).toHaveLength(es.length);
        expect(new Set(placed)).toEqual(new Set(es));
        for (const r of plan.rooms) {
          expect(r.works.length + (r.bgm === null ? 0 : 1)).toBeGreaterThan(0);
          if (r.source === 'CURRENT') expect(r.bgm).toBeNull();
        }
      }),
      { seed: 20261111, numRuns: 500 },
    );
  });
});
