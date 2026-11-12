import { config } from '@gallery/core/config';
import { useEffect, useRef } from 'react';
import s from './Toast.module.css';

/**
 * 알림 띠가 떠 있는 시간. 값은 `config.ts`(`TOAST_SEC`).
 * 되살리기 토스트는 `UNDO_DELETE_SEC`를 넘겨 쓴다.
 */
export const TOAST_SEC = config().TOAST_SEC;

export interface ToastProps {
  readonly message: string;
  readonly onDone: () => void;
  readonly seconds?: number;
  /** 글자 단추 하나(예: `되살리기`) */
  readonly action?: { readonly label: string; readonly onClick: () => void } | undefined;
}

/**
 * 화면 아래 알림 띠(덮개가 아니다 — PLAN §7.2). 정한 시간이 지나면 `onDone`. 같은 글을 다시 띄우려면 `key`를 바꾼다.
 */
export const Toast = ({ message, onDone, seconds = TOAST_SEC, action }: ToastProps) => {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => done.current(), seconds * 1000);
    return () => clearTimeout(id);
  }, [seconds, message]);

  return (
    <div className={s.toast} role="status" aria-live="polite" data-testid="teacher-toast">
      <span>{message}</span>
      {action ? (
        <button type="button" className={s.action} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
};
