import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { Viewport } from '@gallery/core/types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon.tsx';
import type { ZoomPage } from '../../viewer/zoom/zoomPages.ts';
import s from './walkUi.module.css';
import { MAG_NONE, type Magnify, magnifyTo, panBy, toggleMagnify } from './pageMagnify.ts';

/**
 * 크게 보기의 여러 쪽(P4-4, PLAN §5.6·§6.8, PRD 6.7): PDF·긴 세로·파노라마·글이 많은 그림은 쪽마다 HTML 그림으로.
 * 쪽 계산(`zoomPagesFor`)은 이 상자의 크기를 받아 쪽마다 "이미지 안 사각형 → 쪽 안 자리" 조각을 낸다. 조각은
 * 원본 크기로 잘라(`object-position`) 배율만큼 키운다 — 그림의 실제 크기를 몰라도 된다.
 * 넘기기: `‹ ›`·좌우 키(걷기 키보다 먼저)·밀기. 넘김은 `--t-page`.
 */
export const PageZoom = ({
  pagesFor,
  onPage,
  onPastEnd,
}: {
  /** 상자 크기(CSS px)·화소 비율 → 쪽들 */
  pagesFor: (vp: Viewport, dpr: number) => readonly ZoomPage[];
  onPage?: (page: number, total: number) => void;
  /** 마지막 쪽에서 `›`(오른쪽 키) — 다음 작품으로(PRD G-03). 없으면 잠김 */
  onPastEnd?: (() => void) | undefined;
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
      if (d === 1 && page >= total - 1) {
        onPastEnd?.();
        return;
      }
      setDir(d);
      setPage(p => Math.max(0, Math.min(total - 1, p + d)));
    },
    [total, page, onPastEnd],
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
  // 두 번 누르기·두 손가락 확대(PRD G-03): 쪽이 바뀌면 1배로
  const [mag, setMag] = useState<Magnify>(MAG_NONE);
  useEffect(() => setMag(MAG_NONE), [page, pages]);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const size = (): { w: number; h: number } => ({ w: cur?.w ?? 1, h: cur?.h ?? 1 });
  // 휴대폰 세로에서 한 장으로 둔 글 많은 쪽: "가로로 돌리면 더 크게 보여요"를 처음 한 번(ADR-047)
  const [hintSeen, setHintSeen] = useState(false);
  const showRotate = !hintSeen && cur?.plan.rotateHint === true && window.innerHeight > window.innerWidth;
  return (
    <section
      className={s.pageZoom}
      data-testid="page-zoom"
      data-page={page + 1}
      data-total={total}
      data-scale={mag.s}
      onPointerDown={e => {
        setHintSeen(true);
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2) {
          const [a, b] = [...touches.current.values()];
          pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), s: mag.s };
          start.current = null;
          return;
        }
        start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      }}
      onPointerMove={e => {
        const p = touches.current.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        const { w, h } = size();
        if (touches.current.size >= 2 && pinch.current) {
          const [a, b] = [...touches.current.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const from = pinch.current;
          setMag(m => magnifyTo(m, (from.s * d) / Math.max(1, from.d), w, h));
        } else if (mag.s > 1) setMag(m => panBy(m, dx, dy, w, h));
      }}
      onPointerCancel={e => {
        touches.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onDoubleClick={() => {
        const { w, h } = size();
        setMag(m => toggleMagnify(m, w, h));
      }}
      onPointerUp={e => {
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinch.current = null;
        const st = start.current;
        start.current = null;
        // 확대한 동안의 끌기는 옮기기 — 쪽 넘기기가 아니다
        if (!st || mag.s > 1) return;
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
            style={{
              width: `${cur.w}px`,
              height: `${cur.h}px`,
              ...(mag.s > 1 ? { scale: `${mag.s}`, translate: `${mag.x}px ${mag.y}px` } : {}),
            }}
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
      {showRotate ? (
        <p className={`${s.plate} ${s.rotateHint}`} role="status" data-rotate-hint="1">
          {copy.viewer.rotateHint}
        </p>
      ) : null}
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
            disabled={page >= total - 1 && !onPastEnd}
            aria-label={copy.viewer.next}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      )}
    </section>
  );
};
