import type { PickedFile } from './planUpload.ts';

/**
 * 끌어 놓기·파일 고르기 → 경로가 붙은 파일 목록(PLAN §5.2 "폴더 받기").
 * - 폴더 끌어 놓기: `DataTransferItem.webkitGetAsEntry()`로 폴더를 걸어 내려간다(데스크톱 Chrome·Edge·Safari·Firefox).
 *   `readEntries`는 한 번에 일부만 주므로 빈 배열이 올 때까지 다시 부른다.
 * - 폴더 고르기(`webkitdirectory`)는 `webkitRelativePath`, 그 밖에는 파일 이름만.
 */

const picked = (file: File, path: string): PickedFile => ({ file, name: file.name, path, size: file.size });

export const filesFromList = (list: FileList | readonly File[] | null): PickedFile[] =>
  Array.from(list ?? []).map(f => picked(f, f.webkitRelativePath ? f.webkitRelativePath : f.name));

interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath: string;
}
interface FileEntryLike extends EntryLike {
  file(ok: (f: File) => void, fail: (e: unknown) => void): void;
}
interface DirEntryLike extends EntryLike {
  createReader(): { readEntries(ok: (es: EntryLike[]) => void, fail: (e: unknown) => void): void };
}

const fileOf = (entry: FileEntryLike): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

const readAll = async (dir: DirEntryLike): Promise<EntryLike[]> => {
  const reader = dir.createReader();
  const out: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return out;
    out.push(...batch);
  }
};

const walk = async (entry: EntryLike, out: PickedFile[]): Promise<void> => {
  if (entry.isFile) {
    try {
      const file = await fileOf(entry as FileEntryLike);
      out.push(picked(file, entry.fullPath.replace(/^\/+/, '')));
    } catch {
      // 읽을 수 없는 항목(권한·사라진 파일)은 건너뛴다
    }
    return;
  }
  if (entry.isDirectory) for (const child of await readAll(entry as DirEntryLike)) await walk(child, out);
};

export const filesFromDrop = async (dt: DataTransfer): Promise<PickedFile[]> => {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map(item =>
      typeof item.webkitGetAsEntry === 'function' ? (item.webkitGetAsEntry() as EntryLike | null) : null,
    )
    .filter((e): e is EntryLike => e !== null);
  if (entries.length === 0) return filesFromList(dt.files);
  const out: PickedFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
};

/** 끌어 온 것이 파일인가(글·링크 끌기는 무시) */
export const dragHasFiles = (dt: DataTransfer | null): boolean =>
  dt !== null && Array.from(dt.types ?? []).includes('Files');
