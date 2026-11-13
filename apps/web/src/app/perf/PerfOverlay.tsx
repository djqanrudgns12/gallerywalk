import { copy, fill } from '@gallery/core/copy';
import { useEffect, useState } from 'react';
import type { DeviceBasics } from './deviceReport.ts';
import type { ProbeSnapshot, VisitProbe } from './visitProbe.ts';
import s from './PerfOverlay.module.css';

/**
 * 실기기 숫자판(`?perf=1`, ADR-070): 화면 귀퉁이 작은 표. 1초마다 재기에서 읽어 글만 바꾼다(3D를 다시 그리지 않음).
 * 누름을 받지 않는다(`pointer-events: none`) — 관람 조작을 막지 않는다.
 */

/** 주소에 `perf=1`이 있을 때만 */
export const perfOverlayWanted = (search: string): boolean => new URLSearchParams(search).get('perf') === '1';

const REFRESH_MS = 1000;

const ms = (n: number | null): string =>
  n === null ? copy.perf.none : fill(copy.perf.ms, { n: Math.round(n) });
const sec = (n: number | null): string =>
  n === null ? copy.perf.none : fill(copy.perf.sec, { n: (n / 1000).toFixed(1) });

export const PerfOverlay = ({
  probe,
  basics,
}: {
  readonly probe: VisitProbe;
  readonly basics: DeviceBasics;
}) => {
  const [snap, setSnap] = useState<ProbeSnapshot>(() => probe.snapshot());
  useEffect(() => {
    const t = window.setInterval(() => setSnap(probe.snapshot()), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [probe]);
  const m = snap.marks;
  const rows: readonly (readonly [string, string])[] = [
    [copy.perf.fps, snap.fpsNow === null ? copy.perf.none : String(snap.fpsNow)],
    [copy.perf.frameP95, ms(snap.frameP95Ms)],
    [copy.perf.inputP95, `${ms(snap.inputP95Ms)} (${snap.inputCount})`],
    [copy.perf.longTasks, snap.longTasks === null ? copy.perf.none : String(snap.longTasks)],
    [
      copy.perf.live,
      snap.liveKbps === null ? copy.perf.none : fill(copy.perf.kbps, { n: snap.liveKbps.toFixed(1) }),
    ],
    [copy.perf.peers, snap.peers === null ? copy.perf.none : String(snap.peers)],
    [copy.perf.tier, snap.tier ?? copy.perf.none],
    [
      copy.perf.device,
      `${basics.platform}${basics.osMajor === null ? '' : ` ${basics.osMajor}`} · ${basics.browser} · ${basics.device} · ${snap.gpu}`,
    ],
    [copy.perf.timeline, [m.poster, m.ready, m.enter, m.firstFrame].map(sec).join(' · ')],
  ];
  return (
    <aside className={s.panel} aria-label={copy.perf.label} data-testid="perf-overlay">
      <dl className={s.list}>
        {rows.map(([k, v]) => (
          <div key={k} className={s.row}>
            <dt className={s.key}>{k}</dt>
            <dd className={s.value}>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
};
