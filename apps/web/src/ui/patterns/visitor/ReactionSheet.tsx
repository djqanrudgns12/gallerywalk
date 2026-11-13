import { config } from '@gallery/core/config';
import { copy, fill, roAfter } from '@gallery/core/copy';
import { charCount, type Sticker } from '@gallery/core/types';
import { type JSX, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '../../Icon.tsx';
import s from './ReactionSheet.module.css';

/** 스티커 순서(PRD G-07): 감동했어요 · 새로 알았어요 · 멋져요 · 궁금해요 */
export const STICKERS: readonly Sticker[] = ['MOVED', 'LEARNED', 'GREAT', 'CURIOUS'];

/**
 * 스티커 아이콘. `Icon`에 맞는 모양(마음·전구·별·물음표)이 아직 없어 비워 둔다 — 비어 있으면 글자 칩으로 보인다.
 * 아이콘이 생기면 여기만 채운다(이모지는 쓰지 않음, AGENTS.md §3).
 */
export const STICKER_ICONS: Readonly<Partial<Record<Sticker, IconName>>> = {
  MOVED: 'heart',
  LEARNED: 'bulb',
  GREAT: 'star',
  CURIOUS: 'question',
};

/** 평가 칸(core `ReactionBody` 1~3, PRD G-07 "별 대신 칸 3개") */
const SCORE_CELLS = [1, 2, 3] as const;

export interface ReactionSheetValue {
  readonly sticker: Sticker | null;
  /** 입력 칸 그대로(정리는 보낼 때) */
  readonly memo: string;
  readonly scoreFact: number | null;
  readonly scoreDelivery: number | null;
}

/** 지금 설정이 받는 칸 */
export interface ReactionSheetFields {
  readonly sticker: boolean;
  readonly memo: boolean;
  readonly score: boolean;
}

/** 보내는 중 · 끊겨서 줄에 둠 · 줄에서 보냄 */
export type ReactionSheetStatus = 'idle' | 'sending' | 'queued' | 'sent';

/** 시트 위 작은 줄: 별명 방식("{별명}으로 남겨요 `바꾸기`") · 익명 방식(안내 한 줄) */
export type ReactionSheetIdentity =
  | { readonly kind: 'nickname'; readonly nickname: string | null }
  | { readonly kind: 'anonymous'; readonly audience: 'teacher' | 'everyone' };

export interface NicknameEditState {
  readonly value: string;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface ReactionSheetProps {
  readonly value: ReactionSheetValue;
  readonly fields: ReactionSheetFields;
  /** 이미 남긴 반응이 있음 → `고치기` */
  readonly editing: boolean;
  readonly status: ReactionSheetStatus;
  readonly identity: ReactionSheetIdentity | null;
  /** 보낼 수 없는 값(아무것도 안 고름·평가 한 줄만) — 부른 쪽이 판정 */
  readonly submitDisabled: boolean;
  /** 작품 제목(대화 상자 이름) */
  readonly artworkTitle?: string | null | undefined;
  readonly nicknameEdit?: NicknameEditState | null | undefined;
  /** 메모 칸 아래 문구(`E_MEMO_BLOCKED` 등) */
  readonly memoError?: string | null | undefined;
  /** 단추 위 문구(그 밖의 실패) */
  readonly formError?: string | null | undefined;
  /** 시트 대신 문구만(반응 꺼짐·전시 닫힘) */
  readonly notice?: string | null | undefined;
  readonly onChange: (next: ReactionSheetValue) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly onNicknameEdit?: (() => void) | undefined;
  readonly onNicknameDraft?: ((value: string) => void) | undefined;
  readonly onNicknameSave?: (() => void) | undefined;
  readonly onNicknameCancel?: (() => void) | undefined;
  readonly className?: string | undefined;
}

const statusText = (status: ReactionSheetStatus): string | null =>
  status === 'sending'
    ? copy.reaction.sending
    : status === 'queued'
      ? copy.reaction.queued
      : status === 'sent'
        ? copy.reaction.sent
        : null;

/**
 * 반응 시트(G-07, PLAN §7.3): 아래에서 둥근 시트가 0.3초 동안 올라온다(동작 줄이기면 바로). 순수 표시 부품 — 값·상태는
 * 모두 속성으로 받고, 바꾸면 `onChange`로 알린다. 높이는 화면의 절반 안(넘치면 시트 안에서 밀기), 뒤 3D를 덮는 덮개는 없다.
 */
export const ReactionSheet = (p: ReactionSheetProps): JSX.Element => {
  const titleId = useId();
  const memoId = useId();
  const memoErrorId = useId();
  const nickId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 누를 때마다 튀는 효과를 다시 시작한다(같은 스티커를 또 눌러도)
  const [pop, setPop] = useState<{ readonly sticker: Sticker | null; readonly n: number }>({
    sticker: null,
    n: 0,
  });
  const max = config().MEMO_MAX_CHARS;
  const { value, fields, onChange } = p;

  // 열면 제목으로 초점, 닫으면 연 단추로 되돌림
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // 시트가 문구만 판으로 바뀌면(누른 단추가 사라짐) 그 문구로 초점
  const hasNotice = Boolean(p.notice);
  useEffect(() => {
    if (hasNotice) titleRef.current?.focus();
  }, [hasNotice]);

  const className = p.className ? `${s.sheet} ${p.className}` : s.sheet;

  if (p.notice) {
    return (
      <section className={`${className} ${s.noticeSheet}`} role="dialog" aria-labelledby={titleId}>
        <p id={titleId} ref={titleRef} className={s.noticeText} role="status" tabIndex={-1}>
          {p.notice}
        </p>
        <button type="button" className={s.close} onClick={p.onClose} data-testid="reaction-close">
          <Icon name="close" size={16} />
          <span>{copy.viewer.close}</span>
        </button>
      </section>
    );
  }

  const pickSticker = (sticker: Sticker): void => {
    const next = value.sticker === sticker ? null : sticker;
    if (next) setPop(prev => ({ sticker: next, n: prev.n + 1 }));
    onChange({ ...value, sticker: next });
  };
  const pickScore = (key: 'scoreFact' | 'scoreDelivery', n: number): void =>
    onChange({ ...value, [key]: value[key] === n ? null : n });

  const onMemoKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !p.submitDisabled && p.status !== 'sending') {
      e.preventDefault();
      p.onSubmit();
    }
  };

  const scoreHint =
    fields.score && (value.scoreFact === null) !== (value.scoreDelivery === null)
      ? copy.reaction.scorePairHint
      : null;
  const note = statusText(p.status);
  const edit = p.nicknameEdit ?? null;

  // Esc: 별명 고치기 중이면 그것만 접고, 아니면 시트를 닫는다
  const onSheetKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (edit) p.onNicknameCancel?.();
    else p.onClose();
  };

  return (
    <section
      className={className}
      role="dialog"
      aria-labelledby={titleId}
      aria-busy={p.status === 'sending' || undefined}
      data-testid="reaction-sheet"
      onKeyDown={onSheetKey}
    >
      <div className={s.head}>
        <div className={s.identity}>
          {edit ? (
            <div className={s.nickEdit}>
              <label className={s.srOnly} htmlFor={nickId}>
                {copy.consent.nickname}
              </label>
              <input
                id={nickId}
                className={s.nickInput}
                type="text"
                value={edit.value}
                maxLength={config().NICKNAME_MAX_CHARS}
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={edit.error !== null}
                onChange={e => p.onNicknameDraft?.(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    p.onNicknameSave?.();
                  }
                }}
              />
              <button
                type="button"
                className={s.linkBtn}
                onClick={p.onNicknameSave}
                disabled={edit.busy}
                data-testid="nickname-save"
              >
                {copy.reaction.changeNickname}
              </button>
              <button type="button" className={s.linkBtn} onClick={p.onNicknameCancel} disabled={edit.busy}>
                {copy.reaction.nicknameCancel}
              </button>
            </div>
          ) : p.identity?.kind === 'nickname' ? (
            <p className={s.identityLine}>
              <span className={s.identityText}>
                {p.identity.nickname
                  ? fill(copy.reaction.asNickname, {
                      nickname: p.identity.nickname,
                      ro: roAfter(p.identity.nickname),
                    })
                  : copy.reaction.noNickname}
              </span>
              {p.onNicknameEdit ? (
                <button
                  type="button"
                  className={s.linkBtn}
                  onClick={p.onNicknameEdit}
                  data-testid="nickname-change"
                >
                  {copy.reaction.changeNickname}
                </button>
              ) : null}
            </p>
          ) : p.identity?.kind === 'anonymous' ? (
            <p className={s.identityLine}>
              <span className={s.identityText}>
                {p.identity.audience === 'everyone'
                  ? copy.reaction.anonymousEveryone
                  : copy.reaction.anonymousTeacher}
              </span>
            </p>
          ) : null}
          {edit?.error ? (
            <p className={s.fieldError} role="alert">
              {edit.error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={s.close}
          onClick={p.onClose}
          aria-label={copy.viewer.close}
          data-testid="reaction-close"
        >
          <Icon name="close" size={16} />
          <span className={s.closeText}>{copy.viewer.close}</span>
        </button>
      </div>

      <h2 id={titleId} ref={titleRef} className={s.title} tabIndex={-1}>
        {copy.viewer.react}
        {p.artworkTitle ? <span className={s.srOnly}>{` ${p.artworkTitle}`}</span> : null}
      </h2>

      {fields.sticker ? (
        <div className={s.stickers} role="group" aria-label={copy.reaction.stickerGroup}>
          {STICKERS.map(sticker => {
            const on = value.sticker === sticker;
            const icon = STICKER_ICONS[sticker];
            return (
              <button
                key={sticker}
                type="button"
                className={s.sticker}
                aria-pressed={on}
                data-sticker={sticker}
                data-pop={on && pop.sticker === sticker && pop.n > 0 ? pop.n % 2 : undefined}
                onClick={() => pickSticker(sticker)}
              >
                {icon ? <Icon name={icon} size={22} /> : null}
                <span>{copy.reaction.stickers[sticker]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {fields.memo ? (
        <div className={s.field}>
          <label className={s.srOnly} htmlFor={memoId}>
            {copy.reaction.memoLabel}
          </label>
          <div className={s.inputWrap}>
            <input
              id={memoId}
              className={s.input}
              type="text"
              value={value.memo}
              maxLength={max}
              placeholder={copy.reaction.memoPlaceholder}
              autoComplete="off"
              enterKeyHint="send"
              aria-invalid={p.memoError ? true : undefined}
              aria-describedby={p.memoError ? memoErrorId : undefined}
              onChange={e => onChange({ ...value, memo: e.target.value })}
              onKeyDown={onMemoKey}
            />
            <span className={s.count} aria-hidden="true">{`${charCount(value.memo)}/${max}`}</span>
          </div>
          {p.memoError ? (
            <p id={memoErrorId} className={s.fieldError} role="alert">
              {p.memoError}
            </p>
          ) : null}
        </div>
      ) : null}

      {fields.score ? (
        <div className={s.scores}>
          {(
            [
              ['scoreFact', copy.reaction.scoreFact],
              ['scoreDelivery', copy.reaction.scoreDelivery],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className={s.scoreRow} role="group" aria-label={label}>
              <span className={s.scoreLabel} aria-hidden="true">
                {label}
              </span>
              <span className={s.cells}>
                {SCORE_CELLS.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={s.cell}
                    aria-pressed={value[key] === n}
                    aria-label={fill(copy.reaction.scoreCell, { label, n, max: SCORE_CELLS.length })}
                    data-filled={value[key] !== null && n <= (value[key] ?? 0) ? true : undefined}
                    onClick={() => pickScore(key, n)}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* 문구·주요 단추는 시트 아래에 붙여 둔다(칸이 많아 시트 안에서 밀어도 늘 보이게) */}
      <div className={s.footer}>
        {note || scoreHint || p.formError ? (
          <div className={s.notes}>
            {scoreHint ? <p className={s.hint}>{scoreHint}</p> : null}
            {p.formError ? (
              <p className={s.formError} role="alert">
                {p.formError}
              </p>
            ) : null}
            {note ? (
              <p className={p.status === 'queued' ? s.queued : s.hint} role="status">
                {note}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className={s.submit}
          disabled={p.submitDisabled || p.status === 'sending'}
          onClick={p.onSubmit}
          data-testid="reaction-submit"
        >
          {p.editing ? copy.reaction.update : copy.reaction.submit}
        </button>
      </div>
    </section>
  );
};
