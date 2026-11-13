import { config } from '@gallery/core/config';
import { useEffect, useState } from 'react';
import type { StudentApi } from '../../ports/index.ts';
import { isVisiting, type VisitorStore } from '../student/visitorStore.ts';
import { deviceBasics } from './deviceReport.ts';
import { startVisitProbe, VisitProbe } from './visitProbe.ts';

/**
 * 학생 전시 화면 하나의 실기기 반응성 재기(ADR-070): 재기를 만들고, 단계 시각·누름 반응·긴 작업을 적고,
 * 관람을 `DEVICE_REPORT_AFTER_SEC`만큼 했거나 그 전에 화면이 숨거나 떠나면 보고를 **한 번** 보낸다(포스터까지 왔을 때만).
 * 보내기 실패는 버린다(관람을 막지 않음).
 */
export const useVisitProbe = (store: VisitorStore, code: string, student: StudentApi): VisitProbe => {
  const [probe] = useState(
    () =>
      new VisitProbe(
        typeof navigator === 'undefined'
          ? { platform: 'other', osMajor: null, browser: 'other', device: 'desktop', memGb: null, net: null }
          : deviceBasics(
              navigator as Navigator & { deviceMemory?: unknown; connection?: { effectiveType?: unknown } },
              typeof screen === 'undefined' ? 0 : Math.min(screen.width, screen.height),
            ),
      ),
  );

  useEffect(() => startVisitProbe(probe), [probe]);

  // 단계 시각
  useEffect(() => {
    const seen = (): void => {
      const s = store.getState();
      if (s.phase === 'poster') {
        probe.mark('poster');
        if (s.progress.ready || s.slow) probe.mark('ready');
      }
      if (isVisiting(s.phase)) {
        probe.mark('enter');
        // 2D는 관람 화면 프레임이 없으므로 들어간 뒤 첫 그리기 차례를 첫 그림으로
        if (s.mode === '2d') requestAnimationFrame(() => probe.mark('firstFrame'));
      }
    };
    seen();
    return store.subscribe(seen);
  }, [store, probe]);

  // 누름 → 다음 그리기 차례
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const now = performance.now();
      const t0 = e.timeStamp > 0 && e.timeStamp <= now ? e.timeStamp : now;
      requestAnimationFrame(() => probe.input(performance.now() - t0));
    };
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', onDown, { capture: true });
  }, [probe]);

  // 긴 작업(아는 브라우저만)
  useEffect(() => {
    if (
      typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('longtask')
    )
      return;
    probe.watchLongTasks();
    const ob = new PerformanceObserver(list => {
      for (let i = list.getEntries().length; i > 0; i -= 1) probe.longTask();
    });
    ob.observe({ type: 'longtask', buffered: true });
    return () => ob.disconnect();
  }, [probe]);

  // 보고 한 번
  useEffect(() => {
    let sent = false;
    let timer: number | null = null;
    const send = (): void => {
      if (sent || !probe.reachedPoster) return;
      sent = true;
      if (timer !== null) window.clearTimeout(timer);
      const s = store.getState();
      student.diag(code, { kind: 'report', report: probe.report(s.mode, s.fallback) }).catch(() => undefined);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') send();
    };
    const arm = (): void => {
      if (timer === null && !sent && isVisiting(store.getState().phase))
        timer = window.setTimeout(send, config().DEVICE_REPORT_AFTER_SEC * 1000);
    };
    arm();
    const unsub = store.subscribe(arm);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', send);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', send);
      if (timer !== null) window.clearTimeout(timer);
      // 화면을 떠남(처음으로) — 아직 안 보냈으면 지금
      send();
    };
  }, [store, probe, code, student]);

  return probe;
};
