import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { normalizeLine, type ExhibitionView } from '@gallery/core/types';
import { useEffect, useId, useRef } from 'react';
import { useStore } from 'zustand';
import { consentAudience, formatDay, type ConsentAudience } from './posterView.ts';
import type { ConsentState, VisitorStore } from './visitorStore.ts';
import s from './ConsentSheet.module.css';

export interface ConsentSheetProps {
  readonly store: VisitorStore;
  readonly view: ExhibitionView;
}

/**
 * 별명·동의 시트(PRD 13.2 문구 그대로, PLAN §7.3). 입장 때의 별명은 함께 관람 이름표로 다른 친구에게 보이므로 늘
 * "다른 친구들도 볼 수 있어요" 판이다(ADR-057). 휴대폰은 아래 시트, 넓은 화면은 가운데 카드. 열린 동안 뒤는 `inert`.
 * 별명 칸이 시트에도 있어 등록이 거절되면 바로 그 칸 아래에 문구를 보이고 고칠 수 있다.
 * 모양은 `ConsentPanel`이 맡고(처음 반응할 때의 동의 `app/reactions`도 같은 것을 쓴다), 여기는 입장 흐름에 잇기만 한다.
 */
export const ConsentSheet = ({ store, view }: ConsentSheetProps) => {
  const nickname = useStore(store, st => st.nickname);
  const consent = useStore(store, st => st.consent);
  const { setNickname, setConsentChecked, confirmConsent, closeConsent, enterWithoutNickname } =
    store.getState();
  return (
    <ConsentPanel
      view={view}
      title={copy.consent.titleEnter}
      audience={consentAudience(view.exhibition.reactions, true)}
      nickname={nickname}
      consent={consent}
      onNicknameChange={setNickname}
      onCheckedChange={setConsentChecked}
      onConfirm={() => void confirmConsent()}
      onBack={closeConsent}
      onSkip={enterWithoutNickname}
      testId="consent-sheet"
    />
  );
};

export interface ConsentPanelProps {
  readonly view: ExhibitionView;
  /** 입장 때 `titleEnter`, 처음 반응할 때 `title`(PRD 13.2) */
  readonly title: string;
  readonly audience: ConsentAudience;
  readonly nickname: string;
  readonly consent: ConsentState;
  readonly onNicknameChange: (nickname: string) => void;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly onConfirm: () => void;
  /** `돌아가기`·Esc */
  readonly onBack: () => void;
  /** 끊겨서 등록하지 못했을 때의 두 번째 단추(`consent.canSkip`일 때만 보임) */
  readonly onSkip?: (() => void) | undefined;
  readonly testId?: string | undefined;
}

/** 동의 시트 모양(PRD 13.2). 상태는 모두 속성으로 받는다 */
export const ConsentPanel = ({
  view,
  title,
  audience,
  nickname,
  consent,
  onNicknameChange,
  onCheckedChange,
  onConfirm,
  onBack,
  onSkip,
  testId,
}: ConsentPanelProps) => {
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const backRef = useRef(onBack);
  const max = config().NICKNAME_MAX_CHARS;

  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);

  // 열면 제목으로 초점, 닫으면 연 단추로 되돌림. Esc로 닫기
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') backRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  const startDisabled = !consent.checked || consent.busy || normalizeLine(nickname) === '';

  return (
    <div className={s.scrim}>
      <div
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={consent.busy || undefined}
        data-testid={testId}
      >
        <h2 id={titleId} ref={titleRef} className={s.title} tabIndex={-1}>
          {title}
        </h2>

        <ul className={s.points}>
          <li>
            <strong>{copy.consent.storedStrong}</strong>
            {copy.consent.storedRest}{' '}
            {audience === 'everyone' ? copy.consent.everyone : copy.consent.teacherOnly}
          </li>
          <li>
            {fill(copy.consent.deletes, {
              date: formatDay(view.exhibition.expiresAt),
              days: config().EXHIBITION_TTL_DAYS,
            })}
          </li>
          <li>
            <strong>{copy.consent.noRealInfo}</strong>
          </li>
        </ul>

        <div className={s.field}>
          <label className={s.label} htmlFor={inputId}>
            {copy.consent.nickname}
          </label>
          <div className={s.inputWrap}>
            <input
              id={inputId}
              className={s.input}
              type="text"
              value={nickname}
              maxLength={max}
              autoComplete="off"
              enterKeyHint="done"
              aria-invalid={consent.error !== null && !consent.canSkip}
              aria-describedby={consent.error ? errorId : undefined}
              onChange={e => onNicknameChange(e.target.value)}
            />
            <span className={s.count} aria-hidden="true">{`${nickname.length}/${max}`}</span>
          </div>
          {consent.error ? (
            <p id={errorId} className={consent.canSkip ? s.notice : s.error} role="alert">
              {consent.error}
            </p>
          ) : null}
        </div>

        <label className={s.agree}>
          <input
            className={s.check}
            type="checkbox"
            checked={consent.checked}
            onChange={e => onCheckedChange(e.target.checked)}
          />
          <span>{copy.consent.agree}</span>
        </label>

        <div className={s.actions}>
          <button type="button" className={s.primary} disabled={startDisabled} onClick={onConfirm}>
            {copy.consent.start}
          </button>
          {consent.canSkip && onSkip ? (
            <button type="button" className={s.secondary} onClick={onSkip}>
              {copy.consent.skipNickname}
            </button>
          ) : null}
          <button type="button" className={s.back} onClick={onBack} disabled={consent.busy}>
            {copy.consent.back}
          </button>
        </div>
      </div>
    </div>
  );
};
