import { config } from '@gallery/core/config';
import { copy, errorCopy, fill, roAfter } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { mediaPath, type RoomTeacher } from '@gallery/core/types';
import { useRef, useState } from 'react';
import { Icon } from '../../../ui/index.ts';
import type { TeacherApi } from '../../../ports/index.ts';
import { precheckFile } from '../upload/precheck.ts';
import { problemFix, problemText } from '../upload/UploadTray.tsx';
import { AutosaveField } from './AutosaveField.tsx';
import type { ManageActions } from './useManage.ts';
import s from './manage.module.css';

export interface RoomSheetProps {
  readonly api: TeacherApi;
  readonly actions: ManageActions;
  readonly exhibitionId: string;
  readonly room: RoomTeacher;
  readonly rooms: readonly RoomTeacher[];
  /** 이 전시실의 작품 수(지운 것 빼고) */
  readonly artworkCount: number;
  readonly onRoomChanged: (room: RoomTeacher) => void;
  readonly onClose: () => void;
}

type BgmState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending'; readonly pct: number }
  | { readonly kind: 'failed'; readonly text: string; readonly fix: string | null };

/**
 * 전시실 시트(G-12, P5-5): 이름판(필수 30자) · 소개 글(200자) · 배경음악(올리기·바꾸기·빼기·미리 듣기)
 * · `이 전시실 지우기`(작품이 있으면 "작품 {n}개는 {다음 전시실}로 옮겨져요" 확인 — 서버가 순서상 첫 다른 전시실로 옮긴다).
 */
export const RoomSheet = ({
  api,
  actions,
  exhibitionId,
  room,
  rooms,
  artworkCount,
  onRoomChanged,
  onClose,
}: RoomSheetProps) => {
  const r = copy.teacher.roomSheet;
  const cfg = config();
  const fileInput = useRef<HTMLInputElement>(null);
  const [bgm, setBgm] = useState<BgmState>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const others = rooms.filter(x => x.id !== room.id);
  const target = others[0] ?? null;
  const lastRoom = others.length === 0;
  const variant = room.bgm?.asset.variants.find(v => v.name === 'audio') ?? room.bgm?.asset.variants[0];

  const sendBgm = async (file: File) => {
    const checked = await precheckFile(file, 'AUDIO');
    if (!checked.ok) {
      setBgm({ kind: 'failed', text: problemText(checked.problem), fix: problemFix(checked.problem) });
      return;
    }
    setBgm({ kind: 'sending', pct: 0 });
    try {
      const next = await api.uploadBgm(
        exhibitionId,
        room.id,
        { blob: file, name: file.name },
        {
          onProgress: p =>
            setBgm({ kind: 'sending', pct: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0 }),
        },
      );
      onRoomChanged(next);
      setBgm({ kind: 'idle' });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'E_SERVER';
      setBgm({ kind: 'failed', text: errorCopy[code], fix: problemFix(code) });
    }
  };

  const removeRoom = () => {
    if (artworkCount > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    void actions.deleteRoom(room.id).catch(() => setConfirming(false));
  };

  return (
    <div className={s.panelBody} data-testid="room-sheet" data-room-id={room.id}>
      <header className={s.panelHead}>
        <h2 className={s.panelTitle}>{room.title}</h2>
        <button type="button" className={s.iconBtn} aria-label={copy.teacher.panel.close} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <AutosaveField
        key={`room-title-${room.id}`}
        label={r.name}
        value={room.title}
        required
        maxChars={cfg.ROOM_TITLE_MAX_CHARS}
        onSave={title => actions.patchRoom(room.id, { title })}
        testId="room-title"
      />
      <AutosaveField
        key={`room-intro-${room.id}`}
        label={r.intro}
        value={room.intro ?? ''}
        multiline
        maxChars={cfg.ROOM_INTRO_MAX_CHARS}
        onSave={v => actions.patchRoom(room.id, { intro: v.trim() === '' ? null : v })}
        testId="room-intro"
      />

      <section className={s.bgm} aria-label={r.bgm}>
        <span className={s.fieldLabel}>{r.bgm}</span>
        {room.bgm && variant ? (
          <audio
            className={s.audio}
            controls
            preload="none"
            src={mediaPath(exhibitionId, room.bgm.asset.assetId, variant)}
            aria-label={r.bgmPreview}
            data-testid="bgm-preview"
          />
        ) : (
          <span className={s.hint}>{r.bgmNone}</span>
        )}
        <span className={s.btnRow}>
          <button
            type="button"
            className={s.btn}
            disabled={bgm.kind === 'sending'}
            onClick={() => fileInput.current?.click()}
            data-testid="bgm-pick"
          >
            {room.bgm ? r.bgmReplace : r.bgmUpload}
          </button>
          {room.bgm ? (
            <button
              type="button"
              className={s.btn}
              disabled={bgm.kind === 'sending'}
              onClick={() => void actions.removeBgm(room.id).catch(() => undefined)}
              data-testid="bgm-remove"
            >
              {r.bgmRemove}
            </button>
          ) : null}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".mp3,.m4a,.wav"
          className={s.hiddenInput}
          data-testid="bgm-input"
          onChange={e => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void sendBgm(f);
          }}
        />
        {bgm.kind === 'sending' ? (
          <span className={s.hint} role="status">
            {fill(copy.teacher.upload.sending, { pct: bgm.pct })}
          </span>
        ) : null}
        {bgm.kind === 'failed' ? (
          <span className={s.fieldError} role="status" data-testid="bgm-error">
            {bgm.fix ? `${bgm.text} · ${bgm.fix}` : bgm.text}
          </span>
        ) : null}
      </section>

      <footer className={s.panelFoot}>
        {confirming && target ? (
          <div
            className={s.confirm}
            role="alertdialog"
            aria-label={r.deleteRoom}
            data-testid="room-delete-confirm"
          >
            <p className={s.confirmText}>
              {fill(r.deleteConfirm, { n: artworkCount, room: target.title, ro: roAfter(target.title) })}
            </p>
            <span className={s.btnRow}>
              <button type="button" className={s.btn} onClick={() => setConfirming(false)}>
                {r.deleteNo}
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnDanger}`}
                onClick={removeRoom}
                data-testid="room-delete-yes"
              >
                {r.deleteYes}
              </button>
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={`${s.btn} ${s.btnDanger}`}
              disabled={lastRoom && artworkCount > 0}
              onClick={removeRoom}
              data-testid="room-delete"
            >
              {r.deleteRoom}
            </button>
            {lastRoom && artworkCount > 0 ? <span className={s.hint}>{r.lastRoom}</span> : null}
          </>
        )}
      </footer>
    </div>
  );
};
