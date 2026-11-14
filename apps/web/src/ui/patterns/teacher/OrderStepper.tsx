import type { CSSProperties, JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './OrderStepper.module.css';

export interface OrderStepperProps {
  /** 지금 차례(1부터) */
  index: number;
  /** 전체 수 */
  total: number;
  onPrev: () => void;
  onNext: () => void;
  /** 앞 단추 이름(예: 앞으로) */
  prevLabel: string;
  /** 뒤 단추 이름(예: 뒤로) */
  nextLabel: string;
  /** 묶음 이름(예: 순서) */
  label: string;
  /** 화면 낭독기가 읽을 차례 글(예: 12점 중 3번째). 없으면 보이는 숫자를 읽는다. */
  valueText?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 순서 앞뒤 단추 + 큰 숫자 `3 / 12` + 눈금 줄(지금 차례만 남색) (G-32 ④, 끌기를 못 쓸 때의 보조 조작).
 * 처음·끝에서는 그쪽 단추가 꺼진다.
 */
export const OrderStepper = ({
  index,
  total,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  label,
  valueText,
  disabled = false,
  className,
}: OrderStepperProps): JSX.Element => {
  const count = Math.max(0, Math.floor(total));
  const at = Math.min(Math.max(1, Math.floor(index)), Math.max(1, count));
  const ticksStyle = { '--ticks': String(Math.max(1, count)) } as CSSProperties;

  return (
    <div className={[s.root, className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      <div className={s.row}>
        <button
          type="button"
          className={s.step}
          aria-label={prevLabel}
          disabled={disabled || at <= 1}
          onClick={onPrev}
          data-step="prev"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <span className={s.num} aria-live="polite" aria-atomic="true">
          {valueText ? <span className={s.srOnly}>{valueText}</span> : null}
          <span aria-hidden={valueText ? true : undefined}>
            <b className={s.now}>{count === 0 ? 0 : at}</b>
            <small className={s.of}>/ {count}</small>
          </span>
        </span>
        <button
          type="button"
          className={s.step}
          aria-label={nextLabel}
          disabled={disabled || at >= count}
          onClick={onNext}
          data-step="next"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      <span className={s.ticks} style={ticksStyle} aria-hidden="true" data-ticks={count}>
        {Array.from({ length: count }, (_, i) => (
          <i
            key={i}
            className={i + 1 === at ? s.tickOn : s.tick}
            data-on={i + 1 === at ? 'true' : undefined}
          />
        ))}
      </span>
    </div>
  );
};
