import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { charCount } from '@gallery/core/types';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import s from './manage.module.css';

/** 입력이 멈추고 저장하기까지(PLAN §7.4 "0.6초 뒤 자동"). 설정 키 후보 — 보고 */
export const AUTOSAVE_DELAY_MS = config().AUTOSAVE_DELAY_MS;

export type SaveState = 'idle' | 'pending' | 'saving' | 'failed';

export interface AutosaveFieldProps {
  readonly label: string;
  /** 서버에 있는 값(저장 뒤 새 값이 오면 입력 중이 아닐 때 맞춘다) */
  readonly value: string;
  readonly onSave: (next: string) => Promise<void>;
  readonly maxChars: number;
  readonly multiline?: boolean | undefined;
  /** 비우면 저장하지 않는다(이름판·전시 이름) */
  readonly required?: boolean | undefined;
  /** 라벨을 눈에 보이지 않게(카드 바로 고치기·머리 제목) */
  readonly hideLabel?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly placeholder?: string | undefined;
  /** Enter·Esc·바깥 누르기로 끝냄(카드 바로 고치기) */
  readonly onDone?: (() => void) | undefined;
  readonly className?: string | undefined;
  readonly testId?: string | undefined;
}

/**
 * 버튼 없이 저장하는 칸(G-11 "입력이 멈추고 0.6초 뒤 자동, 실패하면 칸 옆에 다시 시도").
 * 칸을 떠나거나(blur) 화면에서 사라지면 기다리지 않고 바로 보낸다.
 */
export const AutosaveField = ({
  label,
  value,
  onSave,
  maxChars,
  multiline = false,
  required = false,
  hideLabel = false,
  autoFocus = false,
  placeholder,
  onDone,
  className,
  testId,
}: AutosaveFieldProps) => {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<SaveState>('idle');
  const saved = useRef(value);
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focused = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  latest.current = draft;

  // 서버 값이 바뀌면(다른 곳에서 고침·새로 불러옴) 입력 중이 아닐 때 맞춘다
  useEffect(() => {
    if (!focused.current && state === 'idle') {
      setDraft(value);
      saved.current = value;
    }
  }, [value, state]);

  const inFlight = useRef(false);

  const commit = async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    // 보내는 중이면 겹쳐 보내지 않는다(같은 rev로 두 번 가면 충돌) — 끝난 뒤 남은 것을 이어서
    if (inFlight.current) return;
    const next = latest.current;
    if (next === saved.current) {
      setState(s0 => (s0 === 'pending' ? 'idle' : s0));
      return;
    }
    if (required && next.trim() === '') {
      setState('idle');
      return;
    }
    setState('saving');
    inFlight.current = true;
    try {
      await saveRef.current(next);
      saved.current = next;
      setState(latest.current === next ? 'idle' : 'pending');
      if (latest.current !== next) timer.current = setTimeout(() => void commit(), AUTOSAVE_DELAY_MS);
    } catch {
      setState('failed');
    } finally {
      inFlight.current = false;
    }
  };

  // 사라질 때 남은 것을 보낸다
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        const next = latest.current;
        if (next !== saved.current && !(required && next.trim() === ''))
          void saveRef.current(next).catch(() => undefined);
      }
    },
    [required],
  );

  const change = (next: string) => {
    setDraft(next);
    latest.current = next;
    setState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), AUTOSAVE_DELAY_MS);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!onDone) return;
    if (e.key === 'Escape' || (e.key === 'Enter' && !multiline)) {
      e.preventDefault();
      void commit();
      onDone();
    }
  };

  const over = charCount(draft) > maxChars;
  const common = {
    id,
    value: draft,
    autoFocus,
    placeholder,
    className: multiline ? s.textarea : s.input,
    'aria-invalid': over || undefined,
    'data-testid': testId,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      void commit();
      onDone?.();
    },
    onKeyDown,
  } as const;

  return (
    <div className={`${s.field} ${className ?? ''}`} data-save-state={state}>
      <label htmlFor={id} className={hideLabel ? s.srOnly : s.fieldLabel}>
        {label}
      </label>
      <div className={s.fieldRow}>
        {multiline ? (
          <textarea {...common} rows={4} onChange={e => change(e.target.value)} />
        ) : (
          <input {...common} type="text" onChange={e => change(e.target.value)} />
        )}
        {state === 'failed' ? (
          <button
            type="button"
            className={s.retry}
            data-testid={testId ? `${testId}-retry` : undefined}
            onMouseDown={e => e.preventDefault()}
            onClick={() => void commit()}
          >
            {copy.teacher.manage.retrySave}
          </button>
        ) : null}
      </div>
      {multiline || over ? (
        <span className={over ? `${s.count} ${s.countOver}` : s.count}>
          {fill(copy.teacher.manage.charCount, { n: charCount(draft), max: maxChars })}
        </span>
      ) : null}
      {state === 'failed' ? (
        <span className={s.fieldError} role="status">
          {copy.teacher.manage.saveFailed}
        </span>
      ) : null}
    </div>
  );
};
