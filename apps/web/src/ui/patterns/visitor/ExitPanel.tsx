import { copy, fill } from '@gallery/core/copy';
import { type JSX, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './ExitPanel.module.css';

export interface ExitPanelProps {
  /** 열림. 창 하나 규칙(PRD 9.6)은 부르는 쪽이 지킨다 — 이 부품은 이 값만 따른다 */
  readonly open: boolean;
  /** 본 작품 수 */
  readonly seen: number;
  /** 남긴 반응 수 */
  readonly reacted: number;
  readonly onLeave: () => void;
  readonly onRejoin: () => void;
  /** `계속 둘러보기`·Esc */
  readonly onStay: () => void;
  readonly className?: string | undefined;
}

/**
 * 나가기 창(PRD_V2 W-08): 아래에서 올라오는 작은 시트 — 제목 · 통계 한 줄 · `나가기`(주) · `재접속하기`(보조) · `계속 둘러보기`(글자).
 * 보여 주기만 한다(이동·재접속은 부르는 쪽). 뒤 3D를 덮는 덮개는 없고, 휴대폰 세로에서도 세 단추가 한 화면에 들어온다.
 * 열리면 첫 단추로 초점, 초점은 시트 안에서만 돌고, Esc는 `onStay`. 닫히면 연 자리로 초점을 되돌린다.
 */
export const ExitPanel = (p: ExitPanelProps): JSX.Element | null => (p.open ? <OpenPanel {...p} /> : null);

const OpenPanel = ({ seen, reacted, onLeave, onRejoin, onStay, className }: ExitPanelProps): JSX.Element => {
  const titleId = useId();
  const statsId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  // 열면 첫 단추(`나가기`)로 초점, 닫으면 연 자리로 되돌림(그 자리가 아직 화면에 있으면)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Esc는 창 전체에서 먼저 받는다 — 걷기 입력(크게 보기 닫기 등)이 같은 키를 또 받지 않게
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onStay();
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, [onStay]);

  // 초점이 시트 밖으로 나가면(뒤 화면을 눌러 초점이 옮겨 감 등) 첫 단추로 데려온다
  useEffect(() => {
    const back = (e: FocusEvent): void => {
      const sheet = sheetRef.current;
      if (sheet && e.target instanceof Node && !sheet.contains(e.target)) firstRef.current?.focus();
    };
    document.addEventListener('focusin', back);
    return () => document.removeEventListener('focusin', back);
  }, []);

  // Tab·Shift+Tab: 끝에서 처음으로, 처음에서 끝으로
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Tab') return;
    const buttons = sheetRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    const now = document.activeElement;
    if (e.shiftKey && now === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && now === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const stats =
    seen === 0 && reacted === 0
      ? copy.museumWalk.exitStatsNone
      : fill(copy.museumWalk.exitStats, { seen, reacted });

  return (
    <section
      ref={sheetRef}
      className={className ? `${s.sheet} ${className}` : s.sheet}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={statsId}
      data-testid="exit-sheet"
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId} className={s.title}>
        {copy.museumWalk.exitTitle}
      </h2>
      <p id={statsId} className={s.stats}>
        {stats}
      </p>
      <div className={s.actions}>
        <button ref={firstRef} type="button" className={s.primary} onClick={onLeave} data-testid="exit-leave">
          <Icon name="exit" size={18} />
          <span>{copy.museumWalk.exitLeave}</span>
        </button>
        <button type="button" className={s.secondary} onClick={onRejoin} data-testid="exit-rejoin">
          <Icon name="rejoin" size={18} />
          <span>{copy.museumWalk.exitRejoin}</span>
        </button>
        <button type="button" className={s.stay} onClick={onStay} data-testid="exit-stay">
          {copy.museumWalk.exitStay}
        </button>
      </div>
    </section>
  );
};
