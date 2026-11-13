import type { ArtworkKind } from '../../types/index.ts';
import { compareNatural, compareNaturalSegments } from './naturalSort.ts';
import { extensionOf, leadingNumber, roomTitleFromFolder, titleFromName } from './titleFromName.ts';

/**
 * 폴더 규칙(PLAN §5.2, PRD G-10): 받은 파일들을 경로로 전시실 묶음으로 나눈다. 순수 함수 — 파일 내용·DOM을 모른다.
 *
 * - 맨 위 폴더가 하나: 그 아래 하위 폴더 = 전시실. 하위 폴더가 없으면 그 폴더 = 전시실 하나.
 *   맨 위 폴더 바로 안의 파일(하위 폴더가 있을 때)은 맨 위 폴더 이름의 전시실로 묶어 하위 전시실들보다 앞에 둔다.
 * - 맨 위 폴더가 여럿(폴더 여러 개를 함께 놓음): 맨 위 폴더 하나 = 전시실 하나.
 * - 전시실 폴더보다 깊은 폴더(2단계보다 깊음)는 가장 가까운 전시실 폴더에 합친다.
 * - 폴더 없는 파일: 지금 고른 전시실(`currentRoom`, 없으면 null → 화면이 copy의 "전시실 1").
 * - 숨김·시스템 파일·폴더는 조용히 버린다(`dropped`).
 * - 소리: 폴더에서 온 전시실 안 소리가 하나면 배경음악, 여럿이면 이름순 첫째가 배경음악·나머지는 소리 작품.
 *   폴더 없는 파일의 소리는 모두 소리 작품이다(지금 전시실에 이미 고른 곡이 있을 수 있어 덮지 않는다).
 * - 순서: 자연 정렬(`naturalSort.ts`). 입력 순서와 상관없이 같은 결과(결정적).
 */

/** 확장자로 가른 파일 종류. `OTHER` = 받지 않는 형식(SVG 등). `VIDEO`는 묶음에 넣고 화면이 안내한다(G-23). */
export type FileKind = ArtworkKind | 'OTHER';

const KIND_BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map<string, FileKind>([
  ...['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].map(e => [e, 'IMAGE'] as const),
  ['pdf', 'PDF'],
  ['txt', 'TEXT'],
  ...['mp3', 'm4a', 'wav'].map(e => [e, 'AUDIO'] as const),
  ...['mp4', 'm4v', 'mov', 'webm', 'avi', 'mkv', 'wmv', 'mpg', 'mpeg', '3gp'].map(e => [e, 'VIDEO'] as const),
]);

/** 확장자로 종류를 가른다(대소문자 무시). 실제 형식은 기기 사전 검사가 첫 바이트로 다시 확인한다(PLAN §5.3). */
export const fileKindFromName = (fileName: string): FileKind => {
  const ext = extensionOf(fileName);
  return (ext === null ? undefined : KIND_BY_EXTENSION.get(ext)) ?? 'OTHER';
};

/** 숨김·시스템 파일(소문자로 비교). `._*`·`.DS_Store`는 `.`으로 시작해 숨김으로 걸린다 */
const SYSTEM_FILES: ReadonlySet<string> = new Set(['thumbs.db', 'ehthumbs.db', 'desktop.ini', 'icon\r']);
/** 시스템 폴더(소문자로 비교): 압축 풀기 찌꺼기, Windows 이동식 디스크 */
const SYSTEM_DIRS: ReadonlySet<string> = new Set(['__macosx', '$recycle.bin', 'system volume information']);

export const isIgnoredFileName = (name: string): boolean =>
  name.startsWith('.') || SYSTEM_FILES.has(name.toLowerCase());

const isIgnoredDirName = (name: string): boolean =>
  name.startsWith('.') || SYSTEM_DIRS.has(name.toLowerCase());

/** 받은 항목: 폴더 기준 상대 경로(`webkitRelativePath`·`webkitGetAsEntry().fullPath`, 구분자 `/`)와 크기 */
export interface UploadEntry {
  readonly path: string;
  readonly size: number;
}

export interface UploadItem<E extends UploadEntry = UploadEntry> {
  /** 받은 항목 그대로(화면이 `File`을 함께 실어 보내면 그대로 돌아온다) */
  readonly entry: E;
  /** 정리한 경로(NFC, 빈 조각·`.` 조각·앞 `/` 없음) */
  readonly path: string;
  readonly fileName: string;
  readonly kind: FileKind;
  /** `titleFromName(fileName)`. 비면 ''(화면이 copy의 "제목 없는 작품") */
  readonly title: string;
}

export interface RoomBundle<E extends UploadEntry = UploadEntry> {
  /** `FOLDER` = 올린 폴더에서 나온 새 전시실, `CURRENT` = 폴더 없는 파일을 지금 고른 전시실에 넣음 */
  readonly source: 'FOLDER' | 'CURRENT';
  /** 원래 폴더 이름(NFC). `CURRENT`면 null */
  readonly folderName: string | null;
  /**
   * 이름판. `FOLDER`면 `roomTitleFromFolder(folderName)`(비면 ''), `CURRENT`면 받은 `currentRoom` 그대로
   * (없으면 null → 화면이 copy의 "전시실 1")
   */
  readonly title: string | null;
  /** 폴더 이름의 앞번호(`leadingNumber`). 없거나 `CURRENT`면 null. 묶음 배열의 순서가 곧 정렬 순서다 */
  readonly sortNumber: number | null;
  /** 작품 파일(그림·PDF·글·소리 작품·영상·그 밖) — 이름순(자연 정렬). 배경음악은 빠진다 */
  readonly works: readonly UploadItem<E>[];
  /** 배경음악. 폴더 전시실에 소리가 있을 때만 */
  readonly bgm: UploadItem<E> | null;
}

export interface UploadPlan<E extends UploadEntry = UploadEntry> {
  /** `CURRENT` 묶음(있으면) 먼저, 그다음 폴더 전시실을 폴더 경로의 자연 정렬 순서로 */
  readonly rooms: readonly RoomBundle<E>[];
  /** 조용히 버린 항목(숨김·시스템 파일, 빈 경로) — 경로 자연 정렬 순서 */
  readonly dropped: readonly E[];
}

interface Kept<E extends UploadEntry> {
  readonly entry: E;
  readonly dirs: readonly string[];
  readonly fileName: string;
}

interface Group<E extends UploadEntry> {
  readonly roomDirs: readonly string[];
  readonly members: { readonly kept: Kept<E>; readonly relative: readonly string[] }[];
}

const splitPath = (path: string): string[] =>
  path
    .normalize('NFC')
    .split('/')
    .filter(s => s !== '' && s !== '.');

const compareEntries = (a: UploadEntry, b: UploadEntry): number =>
  compareNatural(a.path, b.path) || a.size - b.size;

export const groupUpload = <E extends UploadEntry>(
  entries: readonly E[],
  currentRoom: string | null,
): UploadPlan<E> => {
  const dropped: E[] = [];
  const kept: Kept<E>[] = [];
  for (const entry of entries) {
    const segments = splitPath(entry.path);
    const fileName = segments[segments.length - 1];
    const dirs = segments.slice(0, -1);
    if (fileName === undefined || isIgnoredFileName(fileName) || dirs.some(isIgnoredDirName)) {
      dropped.push(entry);
      continue;
    }
    kept.push({ entry, dirs, fileName });
  }

  const loose = kept.filter(k => k.dirs.length === 0);
  const inFolders = kept.filter(k => k.dirs.length > 0);
  const tops = new Set(inFolders.map(k => k.dirs[0]!));
  // 전시실 폴더의 깊이: 맨 위 폴더가 하나이고 하위 폴더가 있으면 2(하위 폴더 = 전시실), 아니면 1.
  const roomDepth = tops.size === 1 && inFolders.some(k => k.dirs.length >= 2) ? 2 : 1;

  const groups = new Map<string, Group<E>>();
  for (const k of inFolders) {
    // 맨 위 폴더 바로 안의 파일은 맨 위 폴더 전시실로(roomDepth 2일 때만 생긴다).
    const depth = Math.min(roomDepth, k.dirs.length);
    const roomDirs = k.dirs.slice(0, depth);
    const key = roomDirs.join('/');
    let group = groups.get(key);
    if (group === undefined) {
      group = { roomDirs, members: [] };
      groups.set(key, group);
    }
    group.members.push({ kept: k, relative: [...k.dirs.slice(depth), k.fileName] });
  }

  const rooms: RoomBundle<E>[] = [];
  if (loose.length > 0) {
    rooms.push({
      source: 'CURRENT',
      folderName: null,
      title: currentRoom,
      sortNumber: null,
      works: loose
        .map(k => ({ kept: k, relative: [k.fileName] }))
        .sort(compareMembers)
        .map(toItem),
      bgm: null,
    });
  }
  const folderGroups = [...groups.values()].sort((a, b) => compareNaturalSegments(a.roomDirs, b.roomDirs));
  for (const group of folderGroups) {
    const folderName = group.roomDirs[group.roomDirs.length - 1]!;
    const items = group.members.sort(compareMembers).map(toItem);
    const bgm = items.find(item => item.kind === 'AUDIO') ?? null;
    rooms.push({
      source: 'FOLDER',
      folderName,
      title: roomTitleFromFolder(folderName),
      sortNumber: leadingNumber(folderName),
      works: bgm === null ? items : items.filter(item => item !== bgm),
      bgm,
    });
  }

  return { rooms, dropped: dropped.sort(compareEntries) };
};

const compareMembers = <E extends UploadEntry>(
  a: { readonly kept: Kept<E>; readonly relative: readonly string[] },
  b: { readonly kept: Kept<E>; readonly relative: readonly string[] },
): number => compareNaturalSegments(a.relative, b.relative) || compareEntries(a.kept.entry, b.kept.entry);

const toItem = <E extends UploadEntry>({ kept }: { readonly kept: Kept<E> }): UploadItem<E> => ({
  entry: kept.entry,
  path: [...kept.dirs, kept.fileName].join('/'),
  fileName: kept.fileName,
  kind: fileKindFromName(kept.fileName),
  title: titleFromName(kept.fileName),
});
