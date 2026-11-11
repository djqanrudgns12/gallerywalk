import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../audio/AudioEngine.ts';
import { Icon } from '../../ui/Icon.tsx';
import { deviceKindOf } from '../../viewer/quality/tier.ts';
import type { CardText } from '../../viewer/textures/textCard.ts';
import { pageText, type PagedText } from '../../viewer/zoom/textPages.ts';
import { audioEngine } from './roomMusic.ts';
import s from './walkUi.module.css';

/**
 * 크게 보기의 글·소리(P4-4, PRD 6.8·G-06): 벽에는 캔버스로 조판한 카드가 걸리고, 크게 보면 HTML 글자로 바꿔 선명하게.
 * - 글: 최소 글자 크기 휴대폰 18·태블릿 20·데스크톱 22px, 한 줄 `TEXT_LINE_CHARS`자 안팎. 문단(시는 연) 단위로 쪽을 나눠
 *   `‹ ›`·좌우 키·밀기로 넘긴다(넘김 `--t-page`).
 * - 소리: 명판 + 재생/멈춤. 배경음악은 낮아졌다가 끝나면 돌아온다(소리 엔진).
 */

const fontPx = (): number => {
  const c = config();
  const kind = deviceKindOf(navigator.maxTouchPoints, Math.min(window.screen.width, window.screen.height));
  return kind === 'phone'
    ? c.TEXT_MIN_PX_PHONE
    : kind === 'tablet'
      ? c.TEXT_MIN_PX_TABLET
      : c.TEXT_MIN_PX_DESKTOP;
};

export const TextZoom = ({
  text,
  onPage,
}: {
  text: CardText;
  onPage?: (page: number, total: number) => void;
}) => {
  const px = useMemo(fontPx, []);
  const body = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [paged, setPaged] = useState<PagedText | null>(null);
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  // 쪽 높이·글자 폭이 정해지면 같은 CSS로 재서 나눈다(창 크기가 바뀌면 다시)
  useLayoutEffect(() => {
    const el = body.current;
    const box = probe.current;
    if (!el || !box) return;
    const measure = (piece: string): number => {
      const p = document.createElement('p');
      p.className = s.textZoomPara ?? '';
      p.textContent = piece;
      box.replaceChildren(p);
      const mb = Number.parseFloat(getComputedStyle(p).marginBottom) || 0;
      return p.getBoundingClientRect().height + mb;
    };
    const run = (): void => {
      const h = el.clientHeight;
      if (h <= 0) return;
      setPaged(pageText(text.body, h, measure));
      box.replaceChildren();
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text.body]);

  const total = paged?.pages.length ?? 1;
  const go = useCallback(
    (d: 1 | -1) => {
      setDir(d);
      setPage(p => Math.max(0, Math.min(total - 1, p + d)));
    },
    [total],
  );
  useEffect(() => setPage(p => Math.min(p, total - 1)), [total]);
  useEffect(() => onPage?.(page + 1, total), [onPage, page, total]);
  // 좌우 키는 쪽 넘기기(걷기 키보다 먼저 받아 크게 보기가 닫히지 않게)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) go(e.code === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, [go]);
  // 밀기: 가로로 충분히 빠르게 밀면 넘김(PRD 8.2 스와이프 기준)
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const c = config();

  const pieces = paged?.pages[page] ?? [];
  const maxW = Math.round(c.TEXT_LINE_CHARS * px * 1.02);
  return (
    <section
      className={s.textZoom}
      style={{ fontSize: `${px}px`, width: `min(calc(100vw - 2 * var(--s-3)), ${maxW + 2 * px * 1.6}px)` }}
      data-testid="text-zoom"
      aria-label={text.title}
      onPointerDown={e => {
        start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      }}
      onPointerUp={e => {
        const st = start.current;
        start.current = null;
        if (!st) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        const ms = performance.now() - st.t;
        if (
          Math.abs(dx) >= c.SWIPE_MIN_PX &&
          Math.abs(dx) >= Math.abs(dy) * c.SWIPE_AXIS_RATIO &&
          ms <= c.SWIPE_MAX_MS
        )
          go(dx < 0 ? 1 : -1);
      }}
    >
      <h2 className={s.textZoomTitle}>{text.title}</h2>
      <div className={s.textZoomBody} ref={body}>
        <div key={page} className={dir > 0 ? s.textZoomPageNext : s.textZoomPagePrev}>
          {pieces.map((p, i) => (
            <p key={`${p.group}:${i}`} className={`${s.textZoomPara} ${paged?.poem ? s.textZoomPoem : ''}`}>
              {p.text}
            </p>
          ))}
        </div>
        <div ref={probe} className={`${s.textZoomProbe} ${paged?.poem ? s.textZoomPoem : ''}`} aria-hidden />
      </div>
      <footer className={s.textZoomFoot}>
        {text.author ? <span className={s.textZoomAuthor}>{text.author}</span> : <span />}
        {total > 1 && (
          <span className={s.textZoomPager}>
            <button
              type="button"
              className={s.textZoomTurn}
              onClick={() => go(-1)}
              disabled={page <= 0}
              aria-label={copy.viewer.prev}
            >
              <Icon name="chevron-left" />
            </button>
            <span>{fill(copy.viewer.pageOf, { page: page + 1, total })}</span>
            <button
              type="button"
              className={s.textZoomTurn}
              onClick={() => go(1)}
              disabled={page >= total - 1}
              aria-label={copy.viewer.next}
            >
              <Icon name="chevron-right" />
            </button>
          </span>
        )}
      </footer>
    </section>
  );
};

/** 소리 작품 명판: 재생/멈춤(배경음악을 낮춤). 화면을 닫으면 멈춘다 */
export const AudioZoom = ({ text, track }: { text: CardText; track: Track }) => {
  const [playing, setPlaying] = useState(false);
  useEffect(
    () => () => {
      audioEngine().stopArtwork();
    },
    [],
  );
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (audioEngine().snapshot().artwork.paused) setPlaying(false);
    }, 500);
    return () => window.clearInterval(t);
  }, [playing]);
  return (
    <section className={`${s.plate} ${s.audioZoom}`} data-testid="audio-zoom" aria-label={text.title}>
      <h2 className={s.textZoomTitle}>{text.title}</h2>
      {text.author && <p className={s.textZoomAuthor}>{text.author}</p>}
      <button
        type="button"
        className={s.exitPrimary}
        aria-pressed={playing}
        onClick={() => {
          if (playing) {
            audioEngine().stopArtwork();
            setPlaying(false);
            return;
          }
          void audioEngine()
            .unlock()
            .then(() => {
              audioEngine().playArtwork(track);
              setPlaying(true);
            });
        }}
      >
        <Icon name={playing ? 'sound-off' : 'play'} />
        <span>{playing ? copy.viewer.stopSound : copy.viewer.playSound}</span>
      </button>
    </section>
  );
};
