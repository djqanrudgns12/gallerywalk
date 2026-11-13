import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { type CSSProperties, type JSX, useId } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './MoveButtons.module.css';

/** 행동 단추가 지금 할 일(PRD_V2 W-01): 점프 · 도슨트에게 말걸기 · 대문에서 나가기 */
export type MoveAction = 'jump' | 'talk' | 'exit';

const ACTION_COPY: Readonly<Record<MoveAction, string>> = {
  jump: copy.museumWalk.actionJump,
  talk: copy.museumWalk.actionTalk,
  exit: copy.museumWalk.actionExit,
};

export interface MoveButtonsProps {
  /** 뛰기 단추가 켜져 있는가 */
  running: boolean;
  /** 예절 알림 뒤 잠깐 뛰기가 잠긴 동안(흐리게, 누를 수는 있음) */
  runLocked?: boolean | undefined;
  onRunToggle: () => void;
  /** 행동 단추를 눌렀다(점프·말걸기·나가기 — 무엇을 할지는 부르는 쪽이 정함) */
  onJump: () => void;
  /** 행동 단추에 보일 일. 없으면 점프 */
  action?: MoveAction | undefined;
  className?: string | undefined;
}

/**
 * 자유 관람 몸 움직임 단추(ADR-057 보충): 뛰기(켜고 끄기) · 행동(점프 → 도슨트 앞 `말걸기` · 대문 앞 `나가기`).
 * 휴대폰·태블릿은 조이스틱 반대편 엄지 자리, 데스크톱은 Shift·스페이스와 같은 일을 하는 보조 단추.
 * 행동 단추는 같은 자리에서 아이콘·글자만 `ACTION_SWAP_SEC` 동안 바뀐다(동작 줄이기면 바로).
 */
export const MoveButtons = ({
  running,
  runLocked = false,
  onRunToggle,
  onJump,
  action = 'jump',
  className,
}: MoveButtonsProps): JSX.Element => {
  const runLockedId = useId();
  const label = ACTION_COPY[action];
  const swap = { '--action-swap': `${config().ACTION_SWAP_SEC}s` } as CSSProperties;
  return (
    <div className={className ? `${s.cluster} ${className}` : s.cluster} style={swap}>
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
        className={action === 'jump' ? s.btn : `${s.btn} ${s.act}`}
        aria-label={label}
        data-action={action}
        onPointerDown={e => {
          // 누르는 순간 바로(손을 떼기를 기다리지 않음) — 클릭은 키보드로 누를 때만. 초점도 가져가지 않는다
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
        {/* 단추는 그대로 두고(키보드 초점 유지) 안쪽만 새로 붙여 바뀌는 연출 */}
        <span key={action} className={s.face}>
          <Icon name={action} size={20} />
          <span className={s.label}>{label}</span>
        </span>
      </button>
    </div>
  );
};
