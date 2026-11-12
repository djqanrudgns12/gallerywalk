import { copy } from '@gallery/core/copy';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dragHasFiles, filesFromDrop, filesFromList } from './collectFiles.ts';
import type { PickedFile } from './planUpload.ts';
import s from './upload.module.css';

/** 파일 고르기 창이 보여 줄 형식(PRD 6.2). 실제 형식은 사전 검사가 첫 바이트로 다시 본다 */
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.pdf,.txt,.mp3,.m4a,.wav';

export interface FilePickers {
  readonly inputs: ReactNode;
  pickFiles(): void;
  pickFolder(): void;
}

/** 숨긴 파일·폴더 고르기 칸(주요 버튼 `작품 올리기`와 놓기 영역이 함께 쓴다) */
export const useFilePickers = (onFiles: (files: PickedFile[]) => void): FilePickers => {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const take = (el: HTMLInputElement) => {
    const picked = filesFromList(el.files);
    el.value = '';
    if (picked.length > 0) onFiles(picked);
  };
  // `webkitdirectory`는 React 속성 목록에 없어 직접 단다
  useEffect(() => {
    folder.current?.setAttribute('webkitdirectory', '');
  }, []);
  return {
    inputs: (
      <>
        <input
          ref={files}
          type="file"
          multiple
          accept={ACCEPT}
          className={s.hiddenInput}
          data-testid="pick-files"
          onChange={e => take(e.currentTarget)}
        />
        <input
          ref={folder}
          type="file"
          multiple
          className={s.hiddenInput}
          data-testid="pick-folder"
          onChange={e => take(e.currentTarget)}
        />
      </>
    ),
    pickFiles: () => files.current?.click(),
    pickFolder: () => folder.current?.click(),
  };
};

export interface DropZoneProps {
  /** 작품이 하나도 없으면 큰 놓기 영역, 있으면 얇은 띠 */
  readonly empty: boolean;
  readonly pickers: FilePickers;
}

export const DropZone = ({ empty, pickers }: DropZoneProps) => {
  const u = copy.teacher.upload;
  if (empty)
    return (
      <section className={s.dropBig} data-testid="drop-big">
        <p className={s.dropBigTitle}>{u.dropTitle}</p>
        <div className={s.pickRow}>
          <button type="button" className={`${s.pick} ${s.pickPrimary}`} onClick={pickers.pickFiles}>
            {copy.teacher.manage.upload}
          </button>
          <button type="button" className={s.pick} onClick={pickers.pickFolder}>
            {u.pickFolder}
          </button>
        </div>
        <p className={s.dropHint}>{u.dropHint}</p>
      </section>
    );
  return (
    <div className={s.dropStrip} data-testid="drop-strip">
      <span>{u.dropStrip}</span>
      <span className={s.pickRow}>
        <button type="button" className={s.pick} onClick={pickers.pickFiles}>
          {u.pickFiles}
        </button>
        <button type="button" className={s.pick} onClick={pickers.pickFolder}>
          {u.pickFolder}
        </button>
      </span>
    </div>
  );
};

/** 화면 어디에 놓아도 받는다(PLAN §7.4). 끌고 있는 동안 화면 전체에 테두리 */
export const useWindowDrop = (enabled: boolean, onFiles: (files: PickedFile[]) => void): boolean => {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const take = useRef(onFiles);
  take.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    const enter = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      void filesFromDrop(e.dataTransfer).then(files => {
        if (files.length > 0) take.current(files);
      });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
      depth.current = 0;
      setOver(false);
    };
  }, [enabled]);
  return over;
};

export const DragCover = () => (
  <div className={s.dragCover} data-testid="drag-cover" aria-hidden="true">
    <span className={s.dragCoverText}>{copy.teacher.upload.dropHere}</span>
  </div>
);
