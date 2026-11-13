import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import type { StatusAction } from '../../../ports/index.ts';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../../ui/Icon.tsx';
import { useServices } from '../../services.ts';
import { errorCodeOf, errorText } from '../shared/errorText.ts';
import { teacherLinkUrl } from '../shared/links.ts';
import { TEACHER_PATHS } from '../shared/nav.ts';
import { Sheet } from '../shared/Sheet.tsx';
import { Toast } from '../shared/Toast.tsx';
import c from '../shared/controls.module.css';
import { TeacherCharacterPicker } from '../home/TeacherCharacterPicker.tsx';
import { checkPosterFile, POSTER_ACCEPT } from '../upload/posterFile.ts';
import type { ManageMenuProps } from './contract.ts';
import s from './ManageMenu.module.css';
import { PreloadSheet } from './PreloadSheet.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';

/**
 * `지금 삭제` 단추가 눌리기까지 기다리는 초(PRD G-18 "확인 시트 + 3초 뒤 눌리는 버튼").
 * 값은 `config.ts`(`DELETE_CONFIRM_SEC`).
 */
export const DELETE_CONFIRM_SEC = config().DELETE_CONFIRM_SEC;

/** 메뉴 안의 덮개 하나: 메뉴 · 수업 전 미리 불러오기 · 반응·투어 설정 · 선생님 캐릭터 · 링크 새로 만들기 확인 · 지금 삭제 확인 */
type Overlay = 'none' | 'menu' | 'preload' | 'settings' | 'character' | 'rotate' | 'delete';

/**
 * 전시 관리의 `···` 메뉴(P5-7, PLAN §7.4·§11.1). 자동 투어 · 수업 전 미리 불러오기(시트, P5-10) · QR·주소 다시 보기(열림) ·
 * 반응·투어 설정(V-17, 연 뒤에도 — 시트 → `patchExhibition`) ·
 * 포스터 고르기·바꾸기·빼기(V-02, 그림 하나 → 기기 사전 검사 → `uploadPoster`) · 선생님 캐릭터(V-04, 이 기기에 기억) ·
 * 선생님 링크 복사(이 기기가 링크 토큰을 가질 때만, 경고 문구) · 선생님 링크 새로 만들기 · 전시 닫기/다시 열기 ·
 * 지금 삭제(확인 시트 + `DELETE_CONFIRM_SEC`초 뒤 눌리는 단추 → `deleteExhibition` → `onDeleted`).
 */
export const ManageMenu = ({ exhibition, onChanged, onDeleted, onOpenSheet }: ManageMenuProps) => {
  const { api, device } = useServices();
  const navigate = useNavigate();
  const t = copy.teacher.menu;
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ readonly id: number; readonly text: string } | null>(null);
  // 링크 새로 만들기 뒤 기기 저장이 바뀌므로 다시 읽게 하는 값
  const [sessionRev, setSessionRev] = useState(0);
  const linkToken = useSessionLink(exhibition.id, sessionRev);
  const posterInput = useRef<HTMLInputElement>(null);

  const say = (text: string): void => setToast(prev => ({ id: (prev?.id ?? 0) + 1, text }));
  const closeMenu = (): void => {
    setOverlay('none');
    setError(null);
  };

  // 메뉴 바깥 누르기·Esc로 닫기
  useEffect(() => {
    if (overlay !== 'menu') return;
    const onDown = (e: PointerEvent): void => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) closeMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeMenu();
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overlay]);

  /** 바뀐 전시를 넘기고, rev가 어긋났으면 새로 받아 넘긴다 */
  const fail = async (err: unknown): Promise<void> => {
    setError(errorText(err));
    if (errorCodeOf(err) === 'E_CONFLICT')
      await api.teacher.exhibition(exhibition.id).then(
        v => onChanged(v.exhibition),
        () => undefined,
      );
  };

  const changeStatus = async (action: StatusAction, done: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.teacher.changeStatus(exhibition.id, action));
      closeMenu();
      say(done);
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (linkToken === null) return;
    try {
      await navigator.clipboard.writeText(teacherLinkUrl(linkToken));
      closeMenu();
      say(t.copied);
    } catch {
      setError(t.copyFailed);
    }
  };

  const rotate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.teacher.rotateLink(exhibition.id);
      setSessionRev(n => n + 1);
      closeMenu();
      say(t.rotated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const pickPoster = async (el: HTMLInputElement): Promise<void> => {
    const file = el.files?.[0] ?? null;
    el.value = '';
    if (!file) return;
    const problem = await checkPosterFile(file, file.name);
    if (problem !== null) {
      say(errorCopy[problem]);
      return;
    }
    say(t.posterUploading);
    try {
      onChanged(await api.teacher.uploadPoster(exhibition.id, { blob: file, name: file.name }));
      say(t.posterSaved);
    } catch (err) {
      say(errorText(err));
    }
  };

  const removePoster = async (): Promise<void> => {
    closeMenu();
    try {
      await api.teacher.removePoster(exhibition.id);
    } catch (err) {
      say(errorText(err));
      return;
    }
    // 빼면 전시 행(rev)이 바뀐다 — 새로 받아 넘긴다. 못 받으면 포스터만 비운 채로
    onChanged(
      await api.teacher.exhibition(exhibition.id).then(
        v => v.exhibition,
        () => ({ ...exhibition, poster: null }),
      ),
    );
    say(t.posterRemoved);
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.teacher.deleteExhibition(exhibition.id, exhibition.rev);
      device.forgetExhibition(exhibition.id);
      setOverlay('none');
      onDeleted();
    } catch (err) {
      await fail(err);
      setBusy(false);
    }
  };

  const status = exhibition.status;

  return (
    <div ref={wrap} className={s.wrap}>
      <button
        ref={trigger}
        type="button"
        className={c.iconButton}
        aria-label={t.trigger}
        aria-haspopup="menu"
        aria-expanded={overlay === 'menu'}
        aria-controls={overlay === 'menu' ? menuId : undefined}
        onClick={() => (overlay === 'menu' ? closeMenu() : setOverlay('menu'))}
        data-testid="manage-menu-trigger"
      >
        <Icon name="menu" size={22} />
      </button>

      {overlay === 'menu' ? (
        <div id={menuId} className={s.menu} role="menu" aria-label={t.trigger} data-testid="manage-menu">
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => navigate(TEACHER_PATHS.tour(exhibition.id))}
            data-testid="menu-tour"
          >
            {t.tour}
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setError(null);
              setOverlay('preload');
            }}
            data-testid="menu-preload"
          >
            {t.preload}
          </button>
          {status === 'OPEN' ? (
            <button
              type="button"
              role="menuitem"
              className={s.item}
              onClick={() => {
                closeMenu();
                onOpenSheet();
              }}
              data-testid="menu-show-qr"
            >
              {t.showQr}
            </button>
          ) : null}
          <div className={s.sep} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setError(null);
              setOverlay('settings');
            }}
            data-testid="menu-settings"
          >
            {t.settings}
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              posterInput.current?.click();
              closeMenu();
            }}
            data-testid="menu-poster"
          >
            {exhibition.poster ? t.posterChange : t.posterPick}
          </button>
          {exhibition.poster ? (
            <button
              type="button"
              role="menuitem"
              className={s.item}
              onClick={() => void removePoster()}
              data-testid="menu-poster-remove"
            >
              {t.posterRemove}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setError(null);
              setOverlay('character');
            }}
            data-testid="menu-character"
          >
            {copy.teacher.characterButton}
          </button>
          <div className={s.sep} role="separator" />
          {linkToken !== null ? (
            <button
              type="button"
              role="menuitem"
              className={s.item}
              onClick={() => void copyLink()}
              data-testid="menu-copy-link"
            >
              <span className={s.itemText}>
                {t.copyLink}
                <span className={s.warn}>{t.copyLinkWarn}</span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setError(null);
              setOverlay('rotate');
            }}
            data-testid="menu-rotate"
          >
            {t.rotate}
          </button>
          <div className={s.sep} role="separator" />
          {status === 'OPEN' ? (
            <button
              type="button"
              role="menuitem"
              className={s.item}
              disabled={busy}
              onClick={() => void changeStatus('close', t.closed)}
              data-testid="menu-close"
            >
              {t.close}
            </button>
          ) : null}
          {status === 'CLOSED' ? (
            <button
              type="button"
              role="menuitem"
              className={s.item}
              disabled={busy}
              onClick={() => void changeStatus('reopen', t.reopened)}
              data-testid="menu-reopen"
            >
              {t.reopen}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`${s.item} ${s.itemDanger}`}
            onClick={() => {
              setError(null);
              setOverlay('delete');
            }}
            data-testid="menu-delete"
          >
            {t.deleteNow}
          </button>
          {error ? (
            <p className={`${c.error} ${s.menuError}`} role="alert" data-testid="menu-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <input
        ref={posterInput}
        type="file"
        accept={POSTER_ACCEPT}
        className={s.hiddenInput}
        data-testid="poster-input"
        onChange={e => void pickPoster(e.currentTarget)}
      />

      {overlay === 'preload' ? <PreloadSheet exhibitionId={exhibition.id} onClose={closeMenu} /> : null}

      {overlay === 'settings' ? (
        <SettingsSheet
          exhibition={exhibition}
          onChanged={onChanged}
          onSaved={message => {
            closeMenu();
            say(message);
          }}
          onClose={closeMenu}
        />
      ) : null}

      {overlay === 'character' ? (
        <TeacherCharacterPicker onClose={closeMenu} onSaved={() => say(copy.teacher.characterSaved)} />
      ) : null}

      {overlay === 'rotate' ? (
        <Sheet
          title={t.rotateTitle}
          onClose={closeMenu}
          testId="rotate-sheet"
          footer={
            <>
              <button type="button" className={c.secondary} onClick={closeMenu} disabled={busy}>
                {copy.teacher.cancel}
              </button>
              <button
                type="button"
                className={c.primary}
                onClick={() => void rotate()}
                disabled={busy}
                data-testid="rotate-confirm"
              >
                {t.rotateConfirm}
              </button>
            </>
          }
        >
          <p className={c.hint}>{t.rotateBody}</p>
          {error ? (
            <p className={c.error} role="alert">
              {error}
            </p>
          ) : null}
        </Sheet>
      ) : null}

      {overlay === 'delete' ? (
        <DeleteSheet busy={busy} error={error} onCancel={closeMenu} onConfirm={() => void remove()} />
      ) : null}

      {toast ? <Toast key={toast.id} message={toast.text} onDone={() => setToast(null)} /> : null}
    </div>
  );
};

/** 이 기기가 아는 선생님 링크 토큰(PIN으로 들어온 기기는 없음 → 복사 항목이 보이지 않는다, §11.1) */
const useSessionLink = (exhibitionId: string, rev: number): string | null => {
  const { device } = useServices();
  const [token, setToken] = useState(() => device.teacherSession(exhibitionId)?.linkToken ?? null);
  useEffect(() => {
    setToken(device.teacherSession(exhibitionId)?.linkToken ?? null);
  }, [device, exhibitionId, rev]);
  return token;
};

/** 지금 삭제 확인: 단추는 `DELETE_CONFIRM_SEC`초 동안 잠겨 남은 초를 보인다(PRD G-18) */
const DeleteSheet = ({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) => {
  const t = copy.teacher.menu;
  const [left, setLeft] = useState(DELETE_CONFIRM_SEC);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(n => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const waiting = left > 0;

  return (
    <Sheet
      title={t.deleteTitle}
      onClose={onCancel}
      testId="delete-sheet"
      footer={
        <>
          <button type="button" className={c.secondary} onClick={onCancel} disabled={busy} data-autofocus>
            {copy.teacher.cancel}
          </button>
          <button
            type="button"
            className={c.danger}
            onClick={onConfirm}
            disabled={waiting || busy}
            data-testid="delete-confirm"
          >
            {busy ? t.deleting : waiting ? fill(t.deleteWait, { n: left }) : t.deleteConfirm}
          </button>
        </>
      }
    >
      <p className={c.hint}>{t.deleteBody}</p>
      {error ? (
        <p className={c.error} role="alert" data-testid="delete-error">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
};
