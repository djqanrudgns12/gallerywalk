import { copy } from '@gallery/core/copy';
import { type JSX, useId } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './MoveButtons.module.css';

export interface MoveButtonsProps {
  /** 뛰기 단추가 켜져 있는가 */
  running: boolean;
  /** 예절 알림 뒤 잠깐 뛰기가 잠긴 동안(흐리게, 누를 수는 있음) */
  runLocked?: boolean | undefined;
  onRunToggle: () => void;
  onJump: () => void;
  className?: string | undefined;
}

/**
 * 자유 관람 몸 움직임 단추(ADR-057 보충): 뛰기(켜고 끄기) · 점프. 휴대폰·태블릿은 조이스틱 반대편 엄지 자리,
 * 데스크톱은 Shift·스페이스와 같은 일을 하는 보조 단추.
 */
export const MoveButtons = ({
  running,
  runLocked = false,
  onRunToggle,
  onJump,
  className,
}: MoveButtonsProps): JSX.Element => {
  const runLockedId = useId();
  return (
    <div className={className ? `${s.cluster} ${className}` : s.cluster}>
      <button
        type="button"
        className={running ? `${s.btn} ${s.on}` : s.btn}
        aria-pressed={running}
        aria-label={copy.viewer.run}
        aria-describedby={runLocked ? runLockedId : undefined}
        data-locked={runLocked || undefined}
        onClick={onRunToggle}
        data-testid="run-toggle"
      >
        <Icon name="run" size={20} />
        <span className={s.label}>{copy.viewer.run}</span>
      </button>
      {runLocked ? (
        <span id={runLockedId} className={s.srOnly}>
          {copy.viewer.runLocked}
        </span>
      ) : null}
      <button
        type="button"
        className={s.btn}
        aria-label={copy.viewer.jump}
        onPointerDown={e => {
          // 누르는 순간 바로(손을 떼기를 기다리지 않음) — 클릭은 키보드로 누를 때만
          e.preventDefault();
          onJump();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onJump();
          }
        }}
        data-testid="jump"
      >
        <Icon name="jump" size={20} />
        <span className={s.label}>{copy.viewer.jump}</span>
      </button>
    </div>
  );
};
