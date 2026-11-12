import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { Viewport } from '@gallery/core/types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon.tsx';
import type { ZoomPage } from '../../viewer/zoom/zoomPages.ts';
import s from './walkUi.module.css';

/**
 * 크게 보기의 여러 쪽(P4-4, PLAN §5.6·§6.8, PRD 6.7): PDF·긴 세로·파노라마·글이 많은 그림은 쪽마다 HTML 그림으로.
 * 쪽 계산(`zoomPagesFor`)은 이 상자의 크기를 받아 쪽마다 "이미지 안 사각형 → 쪽 안 자리" 조각을 낸다. 조각은
 * 원본 크기로 잘라(`object-position`) 배율만큼 키운다 — 그림의 실제 크기를 몰라도 된다.
 * 넘기기: `‹ ›`·좌우 키(걷기 키보다 먼저)·밀기. 넘김은 `--t-page`.
 */
export const PageZoom = ({
  pagesFor,
  onPage,
}: {
  /** 상자 크기(CSS px)·화소 비율 → 쪽들 */
  pagesFor: (vp: Viewport, dpr: number) => readonly ZoomPage[];
  onPage?: (page: number, total: number) => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<readonly ZoomPage[]>([]);
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const run = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setPages(pagesFor({ w, h }, window.devicePixelRatio || 1));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pagesFor]);

  const total = Math.max(1, pages.length);
  useEffect(() => {
    setPage(p => Math.min(p, total - 1));
  }, [total]);
  useEffect(() => {
    onPage?.(page + 1, total);
  }, [onPage, page, total]);
  const go = useCallback(
    (d: 1 | -1) => {
      setDir(d);
      setPage(p => Math.max(0, Math.min(total - 1, p + d)));
    },
    [total],
  );
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
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const c = config();
  const cur = pages[page];
  return (
    <section
      className={s.pageZoom}
      data-testid="page-zoom"
      data-page={page + 1}
      data-total={total}
      onPointerDown={e => {
        start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      }}
      onPointerUp={e => {
        const st = start.current;
        start.current = null;
        if (!st) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        if (
          Math.abs(dx) >= c.SWIPE_MIN_PX &&
          Math.abs(dx) >= Math.abs(dy) * c.SWIPE_AXIS_RATIO &&
          performance.now() - st.t <= c.SWIPE_MAX_MS
        )
          go(dx < 0 ? 1 : -1);
      }}
    >
      <div className={s.pageZoomBox} ref={box}>
        {cur && (
          <div
            key={page}
            className={`${s.pageZoomPage} ${dir > 0 ? s.textZoomPageNext : s.textZoomPagePrev}`}
            style={{ width: `${cur.w}px`, height: `${cur.h}px` }}
          >
            {cur.pieces.map((p, i) => (
              <div
                key={`${p.url}:${i}`}
                className={s.pageZoomPiece}
                style={{ left: `${p.dx}px`, top: `${p.dy}px`, width: `${p.dw}px`, height: `${p.dh}px` }}
              >
                <img
                  src={p.url}
                  alt=""
                  decoding="async"
                  draggable={false}
                  style={{
                    width: `${p.sw}px`,
                    height: `${p.sh}px`,
                    objectFit: 'none',
                    objectPosition: `${-p.sx}px ${-p.sy}px`,
                    transform: `scale(${p.dw / p.sw}, ${p.dh / p.sh})`,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {total > 1 && (
        <div className={s.pageZoomPager}>
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
        </div>
      )}
    </section>
  );
};
