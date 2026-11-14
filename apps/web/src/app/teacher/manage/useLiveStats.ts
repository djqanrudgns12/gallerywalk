import { config } from '@gallery/core/config';
import type { LiveStats } from '@gallery/core/types';
import { useEffect, useState } from 'react';
import { useServices } from '../../services.ts';

const MS_PER_SEC = 1000;

const pageHidden = (): boolean => globalThis.document?.visibilityState === 'hidden';

/**
 * 수업 탭(HT-07)의 지금 관람 수. `enabled`인 동안 곧바로 한 번, 그 뒤 `LIVE_TEACHER_POLL_SEC`마다 `getLive`를 부른다.
 * - 한 번에 하나만: 앞 요청이 끝난 뒤에 다음 차례를 잡는다(느린 망에서 겹쳐 쌓이지 않게).
 * - 화면이 숨으면(`visibilitychange` → hidden) 차례와 보내는 중인 요청을 멈추고, 다시 보이면 곧바로 부른 뒤 이어 간다.
 * - 실패하면 마지막 값을 그대로 두고 조용히 다음 차례에 다시 부른다.
 * - `enabled`가 거짓이면(열리지 않은 전시) 부르지 않고 `null`.
 * 탭이 보일 때만 그려지는 부품 안에서 쓴다(탭을 떠나면 내려가며 멈춘다).
 */
export const useLiveStats = (exhibitionId: string, enabled: boolean): LiveStats | null => {
  const { api } = useServices();
  const [latest, setLatest] = useState<{ readonly id: string; readonly stats: LiveStats } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const periodMs = config().LIVE_TEACHER_POLL_SEC * MS_PER_SEC;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;

    const stopTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const schedule = (): void => {
      stopTimer();
      if (alive && !pageHidden()) timer = setTimeout(() => void tick(), periodMs);
    };
    const tick = async (): Promise<void> => {
      timer = null;
      if (!alive || pageHidden()) return;
      inflight?.abort();
      const mine = new AbortController();
      inflight = mine;
      try {
        const stats = await api.teacher.getLive(exhibitionId, { signal: mine.signal });
        if (alive && inflight === mine) setLatest({ id: exhibitionId, stats });
      } catch {
        // 마지막 값을 둔다(다음 차례에 다시)
      }
      if (alive && inflight === mine) {
        inflight = null;
        schedule();
      }
    };
    const onVisibility = (): void => {
      if (pageHidden()) {
        stopTimer();
        inflight?.abort();
        inflight = null;
      } else if (timer === null && inflight === null) void tick();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      alive = false;
      stopTimer();
      inflight?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, exhibitionId, enabled]);

  return enabled && latest?.id === exhibitionId ? latest.stats : null;
};
