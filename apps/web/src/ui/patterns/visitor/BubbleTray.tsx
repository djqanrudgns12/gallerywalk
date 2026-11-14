import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { type BubbleContent, prepareBubbleText } from '@gallery/core/live';
import { type FormEvent, type JSX, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './BubbleTray.module.css';

export interface BubbleTrayProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 고르면 바로 보내고 닫는다(부모가 onOpenChange(false)도 받음) */
  readonly onSend: (b: BubbleContent) => void;
  /** 교사가 짧은 글을 켰는가(기본 끔) — 꺼져 있으면 쓰기 칸을 그리지 않음 */
  readonly allowText: boolean;
  /** 속도 제한으로 다시 보낼 수 있을 때까지 남은 ms(0 = 보낼 수 있음). >0이면 고르기 막고 copy.bubble.wait */
  readonly waitMs: number;
  readonly device: 'phone' | 'tablet' | 'desktop';
  /** 스티커 그림 주소(UI용 WebP, M4-1 전에는 null → 이름 글자 칩) */
  readonly stickerSrc?: ((i: number) => string | null) | undefined;
  readonly className?: string | undefined;
}

/** 바로 보내기 키로 쓰는 스티커 수(`1`~`8`) */
const SHORTCUT_STICKERS = 8;
/** `t` — 두벌식 한글 자판이면 같은 자리 글쇠가 `ㅅ`(U+3145)으로 온다(화면 문구가 아니라 키 값) */
const OPEN_KEYS: ReadonlySet<string> = new Set(['t', 'T', '\u3145']);

/**
 * 데스크톱 키: 't' → 'open', '1'~'8' → 스티커 0~7 바로 보내기, 그 밖 null.
 * 입력 칸에 초점이 있을 때·다른 창이 열렸을 때는 부모가 부르지 않는다. 한글 자판의 `ㅅ`도 `t`로 본다.
 */
export const bubbleShortcut = (key: string): 'open' | BubbleContent | null => {
  if (OPEN_KEYS.has(key)) return 'open';
  if (/^[1-9]$/.test(key)) {
    const i = Number(key) - 1;
    return i < SHORTCUT_STICKERS && i < config().BUBBLE_STICKERS ? { k: 's', i } : null;
  }
  return null;
};

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/**
 * 머리 위 말풍선 보내기(PRD_V2 W-02, M4-4): 오른쪽 아래 `말풍선` 단추 + 작은 서랍.
 * 휴대폰은 화면 아래 3분의 1 시트(스티커 4×3 격자 + 짧은 말 칩 가로 넘김), 태블릿·데스크톱은 단추 위 팝오버.
 * 고르면 바로 `onSend` 하고 닫는다. 짧은 글은 `allowText`일 때만(다듬기·거름은 `prepareBubbleText` — 서버도 같은 것을 다시 본다).
 * 뒤 3D를 어둡게 덮지 않는다. 열면 첫 고르기 단추로 초점, 닫으면 `말풍선` 단추로 되돌린다. Esc·`닫기`로 닫는다.
 * 보여 주기만 한다 — 보내기·창 하나 규칙(PRD 9.6)·`T` 키 걸기는 부르는 쪽.
 */
export const BubbleTray = (p: BubbleTrayProps): JSX.Element => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(p.open);

  // 서랍이 닫히면 단추로 초점을 되돌린다(처음 그릴 때는 건드리지 않음)
  useEffect(() => {
    if (wasOpen.current && !p.open) triggerRef.current?.focus();
    wasOpen.current = p.open;
  }, [p.open]);

  return (
    <div className={p.className ? `${s.root} ${p.className}` : s.root} data-device={p.device}>
      {p.open ? <Tray {...p} /> : null}
      <button
        ref={triggerRef}
        type="button"
        className={s.trigger}
        aria-expanded={p.open}
        aria-haspopup="dialog"
        onClick={() => p.onOpenChange(!p.open)}
        data-testid="bubble-button"
      >
        <Icon name="talk" size={20} />
        <span>{copy.bubble.button}</span>
      </button>
    </div>
  );
};

const Tray = ({
  onOpenChange,
  onSend,
  allowText,
  waitMs,
  device,
  stickerSrc,
}: BubbleTrayProps): JSX.Element => {
  const titleId = useId();
  const stickerId = useId();
  const phraseId = useId();
  const textId = useId();
  const errorId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const waiting = waitMs > 0;

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  // Esc는 창 전체에서 먼저 받는다 — 걷기 입력이 같은 키를 또 받지 않게
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onOpenChange(false);
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, [onOpenChange]);

  const send = (b: BubbleContent): void => {
    if (waiting) return;
    onSend(b);
    onOpenChange(false);
  };

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (waiting) return;
    const prepared = prepareBubbleText(text);
    if ('text' in prepared) {
      send({ k: 'x', text: prepared.text });
      return;
    }
    if (prepared.error === 'too_long') setError(fill(copy.bubble.tooLong, { n: config().BUBBLE_TEXT_MAX }));
    else if (prepared.error === 'blocked') setError(copy.bubble.blocked);
    else setError(null);
  };

  return (
    <section
      className={device === 'phone' ? s.sheet : s.popover}
      role="dialog"
      aria-labelledby={titleId}
      data-testid="bubble-tray"
    >
      <header className={s.head}>
        <h2 id={titleId} className={s.title}>
          {copy.bubble.trayTitle}
        </h2>
        <button
          type="button"
          className={s.close}
          aria-label={copy.bubble.close}
          onClick={() => onOpenChange(false)}
          data-testid="bubble-close"
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      {waiting ? (
        <p className={s.wait} role="status" data-testid="bubble-wait">
          {copy.bubble.wait}
        </p>
      ) : null}

      <div role="group" aria-labelledby={stickerId}>
        <h3 id={stickerId} className={s.group}>
          {copy.bubble.stickerGroup}
        </h3>
        <div className={s.stickers}>
          {range(config().BUBBLE_STICKERS).map(i => {
            const name = copy.bubble.stickers[i] ?? String(i + 1);
            const src = stickerSrc?.(i) ?? null;
            return (
              <button
                key={i}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                className={src ? s.sticker : `${s.sticker} ${s.stickerText}`}
                aria-label={name}
                disabled={waiting}
                onClick={() => send({ k: 's', i })}
                data-testid={`bubble-sticker-${i}`}
              >
                {src ? (
                  <img className={s.stickerImg} src={src} alt="" draggable={false} />
                ) : (
                  <span>{name}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div role="group" aria-labelledby={phraseId}>
        <h3 id={phraseId} className={s.group}>
          {copy.bubble.phraseGroup}
        </h3>
        <div className={s.phrases}>
          {range(config().BUBBLE_PHRASES).map(i => (
            <button
              key={i}
              type="button"
              className={s.phrase}
              disabled={waiting}
              onClick={() => send({ k: 'p', i })}
              data-testid={`bubble-phrase-${i}`}
            >
              {copy.bubble.phrases[i]}
            </button>
          ))}
        </div>
      </div>

      {allowText ? (
        <form className={s.write} onSubmit={submit} data-testid="bubble-write">
          <label htmlFor={textId} className={s.group}>
            {copy.bubble.textLabel}
          </label>
          <div className={s.writeRow}>
            <input
              id={textId}
              className={s.input}
              type="text"
              value={text}
              enterKeyHint="send"
              autoComplete="off"
              placeholder={fill(copy.bubble.textPlaceholder, { n: config().BUBBLE_TEXT_MAX })}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? errorId : undefined}
              onChange={e => {
                setText(e.target.value);
                setError(null);
              }}
              data-testid="bubble-text"
            />
            <button type="submit" className={s.send} disabled={waiting} data-testid="bubble-text-send">
              {copy.bubble.textSend}
            </button>
          </div>
          {error !== null ? (
            <p id={errorId} className={s.error} role="alert" data-testid="bubble-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
};
