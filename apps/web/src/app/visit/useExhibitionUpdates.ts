import type { ExhibitionView } from '@gallery/core/types';
import { useEffect, useRef } from 'react';
import type { StudentApi } from '../../ports/index.ts';
import { decideLayoutApply, decideUpdate, shouldPoll } from '../../viewer/updates/applyRules.ts';

/**
 * 전시 바뀜 확인·적용(P4-9, ADR-027, PLAN §7.3) — 자유 관람에 맞춤(ADR-059).
 * - 관람 중에만 `CHANGE_POLL_SEC`마다·화면 복귀 때 `GET /api/e/{code}/v`.
 * - 닫힘·준비 중이면 그 화면으로.
 * - 내용·설정만 바뀌면 조용히 새 보기 묶음으로 — 배치 객체는 옛 것을 그대로 둬 걷던 자리·장면이 흔들리지 않게.
 * - 배치가 바뀌었으면: 지금 관이 그대로(또는 관 밖)면 조용히 적용(캐릭터는 그 자리에서 새 벽으로 이어 감),
 *   지금 관이 바뀌었으면 띠 "전시가 새로 바뀌었어요 `새로 보기`"로 미룬다(보던 방이 갑자기 바뀌지 않게).
 */

export type UpdatePlan =
  | { readonly kind: 'APPLY'; readonly view: ExhibitionView }
  | { readonly kind: 'BANNER'; readonly view: ExhibitionView };

/** 새로 받은 보기 묶음을 어떻게 적용할지(순수 함수) */
export const planUpdate = (
  current: ExhibitionView,
  next: ExhibitionView,
  currentStopId: string | null,
): UpdatePlan => {
  if (next.versions.layoutVersion === current.versions.layoutVersion)
    return { kind: 'APPLY', view: { ...next, layout: current.layout } };
  const stopId = currentStopId ?? current.layout.stops[0]?.id ?? '';
  const how = decideLayoutApply(current.layout, next.layout, stopId);
  return { kind: how.kind === 'BANNER' ? 'BANNER' : 'APPLY', view: next };
};

export interface UpdatesArgs {
  readonly code: string;
  /** 지금 보기 묶음(띠로 미룬 것이 있으면 그것). 없으면 확인하지 않음 */
  readonly view: ExhibitionView | null;
  /** 관람 중(포스터·덮개 뒤에서는 확인하지 않음) */
  readonly enabled: boolean;
  readonly student: Pick<StudentApi, 'versions' | 'exhibition'>;
  /** 지금(또는 마지막으로 간) 정지 지점 ID */
  readonly currentStopId: () => string | null;
  readonly onPlan: (plan: UpdatePlan) => void;
  readonly onClosed: () => void;
  readonly onNotReady: () => void;
  /** 시험용 시계·타이머 */
  readonly now?: () => number;
  readonly tickMs?: number;
}

/** 1초마다 "확인할 때인가"를 본다(실제 요청은 `CHANGE_POLL_SEC`마다) */
const TICK_MS = 1000;

export const useExhibitionUpdates = (args: UpdatesArgs): void => {
  const ref = useRef(args);
  ref.current = args;
  const { enabled, code } = args;
  useEffect(() => {
    if (!enabled) return;
    const now = () => ref.current.now?.() ?? Date.now();
    let last = now();
    let busy = false;
    let returned = false;
    const ac = new AbortController();
    const check = async (): Promise<void> => {
      const a = ref.current;
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (busy || !shouldPoll(last, now(), visible, returned)) return;
      busy = true;
      returned = false;
      last = now();
      try {
        if (!a.view) return;
        const v = await a.student.versions(code, { signal: ac.signal });
        const cur = ref.current.view;
        if (!cur) return;
        const action = decideUpdate(cur.versions, v);
        if (action.kind === 'CLOSED') ref.current.onClosed();
        else if (action.kind === 'NOT_READY') ref.current.onNotReady();
        else if (action.kind === 'REFETCH') {
          const next = await a.student.exhibition(code, { signal: ac.signal });
          const now = ref.current.view;
          if (now) ref.current.onPlan(planUpdate(now, next, ref.current.currentStopId()));
        }
      } catch {
        // 끊김·일시 오류는 다음 확인 때 다시(혼자 관람은 그대로). 전시가 사라졌으면 다음 확인의 `versions`가 알려 준다
      } finally {
        busy = false;
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        returned = true;
        void check();
      }
    };
    const t = window.setInterval(() => void check(), args.tickMs ?? TICK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ac.abort();
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // 나머지 값은 ref로 최신 것을 읽는다(타이머 간격은 시험에서만 바꿈)
  }, [enabled, code, args.tickMs]);
};
