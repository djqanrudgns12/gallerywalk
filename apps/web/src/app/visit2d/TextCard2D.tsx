import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deviceKindOf } from '../../viewer/quality/tier.ts';
import type { CardText } from '../../viewer/textures/textCard.ts';
import { pageText, type PagedText } from '../../viewer/zoom/textPages.ts';
import { cardSize } from './slides.ts';
import s from './Visit2DScreen.module.css';

/**
 * 2D 화면의 글 작품: 크게 보기와 같은 HTML 종이 카드(PRD 6.8). 최소 글자 크기 휴대폰 18·태블릿 20·데스크톱 22px,
 * 한 줄 `TEXT_LINE_CHARS`자 안팎. 넘치면 문단(시는 연) 경계에서 쪽을 나눈다(같은 CSS로 재서 `pageText`).
 * 쪽은 화면이 넘긴다(`‹ ›`·좌우 키·밀기가 쪽부터 넘기고 끝 쪽에서 다음 작품으로) — 이 카드는 그리고 쪽 수만 알린다.
 * 카드 모양은 벽에 걸린 글 카드와 같은 비율(배치의 그림 크기, 세로 A4)로 자리 안에 맞춘다(한 줄이 너무 길면 폭을 줄임).
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

export const TextCard2D = ({
  text,
  page,
  onPages,
  box,
  aspect,
}: {
  readonly text: CardText;
  /** 보일 쪽(0부터) */
  readonly page: number;
  /** 잰 쪽 수(창 크기가 바뀌면 다시) */
  readonly onPages: (total: number) => void;
  /** 카드를 놓을 자리(px). 모르면 0 */
  readonly box: { readonly w: number; readonly h: number };
  /** 벽 카드의 가로/세로 */
  readonly aspect: number;
}): JSX.Element => {
  const px = useMemo(fontPx, []);
  const body = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [paged, setPaged] = useState<PagedText | null>(null);

  useLayoutEffect(() => {
    const el = body.current;
    const box = probe.current;
    if (!el || !box) return;
    const measure = (piece: string): number => {
      const p = document.createElement('p');
      p.className = s.textPara ?? '';
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
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', run);
      return () => window.removeEventListener('resize', run);
    }
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text.body]);

  const total = paged?.pages.length ?? 1;
  useEffect(() => onPages(total), [onPages, total]);
  const shown = Math.max(0, Math.min(page, total - 1));
  // 재기 전(첫 그림)에는 본문을 통째로 — 시험 환경처럼 높이를 모르면 그대로 보인다
  const pieces = paged ? (paged.pages[shown] ?? []) : [{ group: 0, text: text.body }];
  const poem = paged?.poem ? s.textPoem : '';
  const lineW = Math.round(config().TEXT_LINE_CHARS * px * 1.02) + 2 * px * 1.6;
  const size = cardSize(box, aspect, lineW);

  return (
    <section
      className={s.textCard}
      style={
        size
          ? { fontSize: `${px}px`, width: size.w, height: size.h }
          : { fontSize: `${px}px`, width: `min(100%, ${lineW}px)` }
      }
      data-testid="visit2d-text"
      aria-label={text.title}
    >
      <h2 className={s.textTitle}>{text.title}</h2>
      <div className={s.textBody} ref={body}>
        <div key={shown} className={s.textPage}>
          {pieces.map((p, i) => (
            <p key={`${p.group}:${i}`} className={`${s.textPara} ${poem}`}>
              {p.text}
            </p>
          ))}
        </div>
        <div ref={probe} className={`${s.textProbe} ${poem}`} aria-hidden />
      </div>
      <footer className={s.textFoot}>
        {text.author ? <span className={s.textAuthor}>{text.author}</span> : <span />}
        {total > 1 ? (
          <span className={s.textPager} aria-live="polite" data-testid="visit2d-text-page">
            {fill(copy.viewer.pageOf, { page: shown + 1, total })}
          </span>
        ) : null}
      </footer>
    </section>
  );
};
