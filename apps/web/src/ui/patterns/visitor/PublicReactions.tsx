import { copy, fill } from '@gallery/core/copy';
import type { Sticker } from '@gallery/core/types';
import { type JSX, useId, useState } from 'react';
import { Icon } from '../../Icon.tsx';
import { STICKER_ICONS, STICKERS } from './ReactionSheet.tsx';
import s from './PublicReactions.module.css';

/** 고른 메모를 한 번에 더 보이는 수(PLAN §7.3 "다섯 개 + `더 보기`") — `config.ts`로 옮길 값 */
const MEMO_STEP = 5;
/** 평가 평균 소수 자리(PLAN §7.3 "소수 한 자리") */
const AVERAGE_DIGITS = 1;

/** 평가 평균을 소수 한 자리로(반올림) */
export const formatAverage = (avg: number): string => {
  const f = 10 ** AVERAGE_DIGITS;
  return (Math.round(avg * f) / f).toFixed(AVERAGE_DIGITS);
};

export interface PublicReactionsProps {
  /** 스티커별 수(0이거나 없는 칸은 숨김) */
  readonly stickers: Readonly<Partial<Record<Sticker, number>>>;
  /** 평가 평균(공개가 꺼졌거나 아직 없으면 null) */
  readonly score: { readonly factAvg: number; readonly deliveryAvg: number } | null;
  /** 교사가 고른 메모(별명이 없으면 `익명`) */
  readonly memos: readonly { readonly nickname: string | null; readonly memo: string }[];
  readonly className?: string | undefined;
}

/**
 * 공개 반응 표시(G-07, PLAN §7.3): 캡션 카드 아래 한 줄에 스티커별 수·평가 평균, `더 보기` 안에 고른 메모 다섯 개씩.
 * 보일 것이 하나도 없으면 아무것도 그리지 않는다. 메모는 글자로만 보인다(HTML을 해석하지 않음, PRD 13.4).
 */
export const PublicReactions = ({
  stickers,
  score,
  memos,
  className,
}: PublicReactionsProps): JSX.Element | null => {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(MEMO_STEP);
  const listId = useId();
  const shown = STICKERS.filter(st => (stickers[st] ?? 0) > 0);
  if (shown.length === 0 && score === null && memos.length === 0) return null;

  return (
    <section
      className={className ? `${s.wrap} ${className}` : s.wrap}
      aria-label={copy.reaction.publicLabel}
      data-testid="public-reactions"
    >
      <div className={s.line}>
        {shown.map(st => {
          const icon = STICKER_ICONS[st];
          const label = copy.reaction.stickers[st];
          return (
            <span key={st} className={s.chip} data-sticker={st}>
              {icon ? <Icon name={icon} size={16} label={label} /> : <span>{label}</span>}
              <span className={s.count}>{stickers[st]}</span>
            </span>
          );
        })}
        {score ? (
          <>
            <span className={s.avg} data-testid="public-score-fact">
              {fill(copy.reaction.average, {
                label: copy.reaction.scoreFact,
                avg: formatAverage(score.factAvg),
              })}
            </span>
            <span className={s.avg} data-testid="public-score-delivery">
              {fill(copy.reaction.average, {
                label: copy.reaction.scoreDelivery,
                avg: formatAverage(score.deliveryAvg),
              })}
            </span>
          </>
        ) : null}
        {memos.length > 0 ? (
          <button
            type="button"
            className={s.more}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              setOpen(o => !o);
              setLimit(MEMO_STEP);
            }}
            data-testid="public-memos-toggle"
          >
            {open ? copy.reaction.memosCollapse : copy.viewer.more}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className={s.memoBox}>
          <ul id={listId} className={s.memos}>
            {memos.slice(0, limit).map((m, i) => (
              <li key={i} className={s.memo}>
                <span className={s.nick}>{m.nickname ?? copy.reaction.anonymous}</span>
                <span className={s.memoText}>{m.memo}</span>
              </li>
            ))}
          </ul>
          {limit < memos.length ? (
            <button
              type="button"
              className={s.more}
              onClick={() => setLimit(l => l + MEMO_STEP)}
              data-testid="public-memos-more"
            >
              {copy.viewer.more}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
