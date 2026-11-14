import { config } from '@gallery/core/config';
import type { DeviceReport, DiagReason } from '@gallery/core/types';
import { type DeviceBasics, gpuOf, quantile, round1, sinceOpen } from './deviceReport.ts';

/**
 * 관람 한 번의 실기기 반응성 재기(G-24·G-25, FIELD_PLAN HR, ADR-070). 학생 전시 화면이 하나 만들고(`startVisitProbe`),
 * 관람 화면·함께 관람·누름 듣기가 지금 것(`activeProbe`)에 적는다. 교사 미리 보기는 만들지 않으므로 아무것도 적지 않는다.
 *
 * - 시각: 화면을 연 때(탐색 시작, `performance.now()`)부터 — 포스터 · 입장 단추 풀림 · 입장 누름 · 입장 뒤 첫 그림.
 * - 프레임: 이어 그린 프레임(움직이는 구간)의 간격만. 멈춘 화면은 그리지 않으므로 긴 틈은 세지 않는다.
 * - 누름 반응: `pointerdown` → 다음 화면 그리기 차례(rAF)까지. Safari에 Event Timing이 없어 모든 기기에서 같은 방법으로 잰다.
 * - 긴 작업: `longtask`를 아는 브라우저(Chromium)만.
 * - 함께 관람: 받은 글 길이 합(KB/초)·이어졌는지·보인 사람 최대.
 * 원문 식별값은 모으지 않는다(갈래만 — `deviceReport.ts`).
 */

/** 표본 상한(메모리) — 넘으면 앞 절반을 버리고 이어 모은다 */
const SAMPLE_MAX = 4000;
/** 이어 그린 프레임으로 보는 간격 상한(ms) — `VisitContent`의 움직임 판정(0.1초)과 같다 */
const CONTINUOUS_FRAME_MS = 100;
const BYTES_PER_KB = 1024;

type Tier = NonNullable<DeviceReport['tierStart']>;
type Mark = 'poster' | 'ready' | 'enter' | 'firstFrame';

const push = (xs: number[], x: number): void => {
  if (xs.length >= SAMPLE_MAX) xs.splice(0, SAMPLE_MAX / 2);
  xs.push(x);
};

/** 숫자판(`?perf=1`)이 1초마다 읽는 지금 값 */
export interface ProbeSnapshot {
  readonly fpsNow: number | null;
  readonly frameP95Ms: number | null;
  readonly inputP95Ms: number | null;
  readonly inputCount: number;
  readonly longTasks: number | null;
  readonly liveKbps: number | null;
  readonly peers: number | null;
  readonly tier: Tier | null;
  readonly gpu: DeviceReport['gpu'];
  readonly marks: Readonly<Record<Mark, number | null>>;
}

export class VisitProbe {
  private readonly basics: DeviceBasics;
  private readonly now: () => number;
  private readonly marks: Record<Mark, number | null> = {
    poster: null,
    ready: null,
    enter: null,
    firstFrame: null,
  };
  private frames: number[] = [];
  private inputs: number[] = [];
  private longTaskCount: number | null = null;
  private gpuName = '';
  private tierStart: Tier | null = null;
  private tierNow: Tier | null = null;
  private liveBytes = 0;
  private liveSince: number | null = null;
  private liveOk: boolean | null = null;
  private peersMax: number | null = null;
  private peersNow: number | null = null;
  /** 숫자판의 지금 fps: 최근 1초 안 프레임 시각 */
  private recent: number[] = [];

  constructor(basics: DeviceBasics, now: () => number = () => performance.now()) {
    this.basics = basics;
    this.now = now;
  }

  /** 기기 갈래(숫자판에 보임) */
  get device(): DeviceBasics {
    return this.basics;
  }

  /** 처음 한 번만 적는다 */
  mark(name: Mark): void {
    if (this.marks[name] === null) this.marks[name] = this.now();
  }

  /** 관람 화면의 프레임(입장 뒤). `dtMs`는 앞 프레임과의 간격 */
  frame(dtMs: number): void {
    this.mark('firstFrame');
    const t = this.now();
    this.recent.push(t);
    while (this.recent.length > 0 && t - this.recent[0]! > 1000) this.recent.shift();
    if (dtMs > 0 && dtMs < CONTINUOUS_FRAME_MS) push(this.frames, dtMs);
  }

  input(latencyMs: number): void {
    if (latencyMs >= 0 && latencyMs <= config().INPUT_LATENCY_MAX_MS) push(this.inputs, latencyMs);
  }

  /** 이 브라우저가 긴 작업을 알려 준다(Chromium) — 없으면 보고에 null */
  watchLongTasks(): void {
    this.longTaskCount ??= 0;
  }

  longTask(): void {
    this.longTaskCount = (this.longTaskCount ?? 0) + 1;
  }

  /** 포스터까지 왔는가(보고를 보낼 만한가) */
  get reachedPoster(): boolean {
    return this.marks.poster !== null;
  }

  gpu(renderer: string): void {
    this.gpuName = renderer;
  }

  tier(t: Tier): void {
    this.tierStart ??= t;
    this.tierNow = t;
  }

  live(status: 'live' | 'off' | 'other'): void {
    if (status === 'live') {
      this.liveOk = true;
      this.liveSince ??= this.now();
    } else if (status === 'other' && this.liveOk === null) this.liveOk = false;
  }

  liveMessage(bytes: number, peers: number): void {
    this.liveBytes += bytes;
    this.peersNow = peers;
    this.peersMax = Math.max(this.peersMax ?? 0, peers);
  }

  private kbps(): number | null {
    if (this.liveSince === null) return null;
    const sec = (this.now() - this.liveSince) / 1000;
    return sec <= 0 ? null : this.liveBytes / BYTES_PER_KB / sec;
  }

  snapshot(): ProbeSnapshot {
    const frames = [...this.frames].sort((a, b) => a - b);
    const inputs = [...this.inputs].sort((a, b) => a - b);
    return {
      fpsNow: this.recent.length > 1 ? this.recent.length - 1 : null,
      frameP95Ms: round1(quantile(frames, 0.95), 5000),
      inputP95Ms: round1(quantile(inputs, 0.95), 5000),
      inputCount: this.inputs.length,
      longTasks: this.longTaskCount,
      liveKbps: round1(this.kbps(), 10_000),
      peers: this.peersNow,
      tier: this.tierNow,
      gpu: gpuOf(this.gpuName),
      marks: { ...this.marks },
    };
  }

  /** 보낼 보고 한 장. `mode`·`fallback`은 학생 전시 상태에서 */
  report(mode: '3d' | '2d', fallback: DiagReason | null): DeviceReport {
    const frames = [...this.frames].sort((a, b) => a - b);
    const inputs = [...this.inputs].sort((a, b) => a - b);
    const fps = frames.map(dt => 1000 / dt).sort((a, b) => a - b);
    const since = this.marks.enter ?? this.marks.poster;
    return {
      v: 1,
      ...this.basics,
      gpu: gpuOf(this.gpuName),
      mode,
      fallback,
      tierStart: this.tierStart,
      tierEnd: this.tierNow,
      posterMs: sinceOpen(this.marks.poster),
      readyMs: sinceOpen(this.marks.ready),
      enterMs: sinceOpen(this.marks.enter),
      firstFrameMs: sinceOpen(this.marks.firstFrame),
      fpsP50: round1(quantile(fps, 0.5), 240),
      fpsP10: round1(quantile(fps, 0.1), 240),
      frameP95Ms: round1(quantile(frames, 0.95), 5000),
      inputP50Ms: round1(quantile(inputs, 0.5), 5000),
      inputP95Ms: round1(quantile(inputs, 0.95), 5000),
      inputCount: Math.min(this.inputs.length, 100_000),
      longTasks: this.longTaskCount === null ? null : Math.min(this.longTaskCount, 100_000),
      liveOk: this.liveOk,
      liveKbps: round1(this.kbps(), 10_000),
      peersMax: this.peersMax === null ? null : Math.min(this.peersMax, 500),
      durSec: since === null ? 0 : Math.min(86_400, Math.max(0, Math.round((this.now() - since) / 1000))),
    };
  }
}

let active: VisitProbe | null = null;

/** 지금 학생 관람의 재기(없으면 null — 교사 미리 보기·개발 화면) */
export const activeProbe = (): VisitProbe | null => active;

export const startVisitProbe = (probe: VisitProbe): (() => void) => {
  active = probe;
  return () => {
    if (active === probe) active = null;
  };
};
