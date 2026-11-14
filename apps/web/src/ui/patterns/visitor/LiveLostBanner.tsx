import { copy } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './LiveLostBanner.module.css';

export interface LiveLostBannerProps {
  /** 보임. 끊긴 지 `LIVE_LOST_BANNER_SEC`가 넘었는지는 부르는 쪽이 판정한다 */
  readonly visible: boolean;
  readonly onRejoin: () => void;
  /** 자리 바꾸기(기본: 위 줄 아래 가운데) */
  readonly className?: string | undefined;
}

/**
 * 끊김 띠(PRD_V2 W-08): 위 줄 아래 가운데의 작은 한 줄 — "연결이 잠시 끊겼어요" + `재접속하기`.
 * 띠는 작게 두어 뒤 3D를 덮지 않는다. 보여 주기만 한다(재접속은 부르는 쪽).
 */
export const LiveLostBanner = ({ visible, onRejoin, className }: LiveLostBannerProps): JSX.Element | null =>
  visible ? (
    <div className={className ? `${s.banner} ${className}` : s.banner} role="status" data-testid="live-lost">
      <Icon name="warning" size={16} className={s.mark} />
      <span className={s.text}>{copy.museumWalk.liveLost}</span>
      <button type="button" className={s.rejoin} onClick={onRejoin} data-testid="live-rejoin">
        <Icon name="rejoin" size={16} />
        <span>{copy.museumWalk.liveRejoin}</span>
      </button>
    </div>
  ) : null;
