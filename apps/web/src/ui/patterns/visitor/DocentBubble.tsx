import { copy } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './DocentBubble.module.css';

export interface DocentBubbleProps {
  /** 말풍선 문구 */
  text: string;
  className?: string | undefined;
}

/** 도슨트 말풍선(관람 예절 알림, 놀이). 위 줄 아래 가운데에 잠깐 떴다가 부모가 지운다 */
export const DocentBubble = ({ text, className }: DocentBubbleProps): JSX.Element => (
  <div className={className ? `${s.bubble} ${className}` : s.bubble} role="status" data-testid="docent">
    <span className={s.who}>
      <Icon name="user" size={16} />
      {copy.viewer.docent}
    </span>
    <span className={s.text}>{text}</span>
  </div>
);
