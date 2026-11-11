import { config } from '@gallery/core/config';
import { equalPowerIn, equalPowerOut } from '@gallery/core/motion';

/**
 * 소리 엔진(G-06, PLAN §8, ADR-011).
 *
 * ```
 * <audio> BGM-A ─ MediaElementSource ─ Gain A ─┐
 * <audio> BGM-B ─ MediaElementSource ─ Gain B ─┴─ Duck ─┐
 * <audio> 작품   ─ MediaElementSource ─ Gain W ─────────┴─ Master(켬/끔) ─ destination
 * ```
 *
 * - 곡은 미디어 요소로 **스트리밍**한다(통째로 디코드하면 곡마다 수십 MB).
 * - 볼륨은 Web Audio `GainNode`로만 바꾼다 — iOS는 `audio.volume`을 무시한다(F-2).
 * - 잠금 풀기는 `입장하기` 누름 안에서: 컨텍스트 재개 + 요소 셋을 무음으로 한 번 재생(그 뒤로는 코드로 재생 가능).
 */

export interface Track {
  readonly id: string;
  readonly url: string;
  /** 앞 무음을 건너뛸 시작점(서버 소리 분석 `audibleStartMs`) */
  readonly startMs?: number;
  /** 곡 크기 맞추기 이득(dB, ±`AUDIO_GAIN_LIMIT_DB`) */
  readonly gainDb?: number;
}

interface Slot {
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
  track: Track | null;
}

export interface AudioSnapshot {
  readonly context: AudioContextState | 'none';
  readonly unlocked: boolean;
  readonly master: number;
  readonly duck: number;
  readonly slots: readonly { id: string | null; gain: number; paused: boolean }[];
  readonly artwork: { id: string | null; paused: boolean };
}

/** 등전력 곡선을 이 개수의 직선 경사로 예약한다(중간에 끊어도 겹침 예외가 없다) */
const CURVE_POINTS = 16;
const dbToGain = (db: number): number => 10 ** (db / 20);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private slots: [Slot, Slot] | null = null;
  private art: Slot | null = null;
  private active: 0 | 1 = 0;
  private unlocked = false;
  private muted = false;
  private readonly cleanups: (() => void)[] = [];

  /**
   * 사용자 누름 안에서 부른다(`입장하기`·투어 시작·`소리` 버튼). 성공하면 true.
   * 실패한 요소가 있어도 컨텍스트가 돌면 true — 그 요소는 다음 누름에서 다시 시도한다.
   */
  async unlock(): Promise<boolean> {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    setPlaybackSession();
    try {
      await ctx.resume();
    } catch {
      return false;
    }
    const silent = silentWavUrl();
    const elements = [...this.slots!.map(s => s.el), this.art!.el];
    await Promise.all(elements.map(el => primeElement(el, silent)));
    this.unlocked = ctx.state === 'running';
    return this.unlocked;
  }

  /**
   * 전시실 배경음악. 같은 곡이면 그대로 둔다(나뉜 관 사이 이동). `null`이면 지금 곡을 줄여 멈춘다.
   * 쉬는 요소에 새 곡을 넣고 등전력 곡선으로 교차 페이드한다.
   */
  playRoom(track: Track | null, seconds = config().BGM_CROSSFADE_SEC): void {
    if (!this.ctx || !this.slots) return;
    const current = this.slots[this.active];
    if (track && current.track?.id === track.id) return;
    const now = this.ctx.currentTime;
    // 지금 곡 줄이기
    if (current.track) fadeCurve(current, now, seconds, 'out', trackGain(current.track));
    const fadingOut = current;
    window.setTimeout(
      () => {
        if (fadingOut.track && fadingOut !== this.slots?.[this.active]) {
          fadingOut.el.pause();
          fadingOut.track = null;
        }
      },
      seconds * 1000 + 50,
    );
    if (!track) return;
    // 쉬는 요소에 새 곡
    const nextIndex = this.active === 0 ? 1 : 0;
    const next = this.slots[nextIndex];
    next.track = track;
    next.el.loop = true;
    next.el.src = track.url;
    next.el.currentTime = (track.startMs ?? 0) / 1000;
    void next.el.play().catch(() => undefined);
    fadeCurve(next, now, seconds, 'in', trackGain(track));
    this.active = nextIndex;
  }

  /** 소리 작품 재생: 배경음악을 낮추고, 끝나면 되돌린다(G-06). */
  playArtwork(track: Track): void {
    if (!this.ctx || !this.art || !this.duck) return;
    const c = config();
    const now = this.ctx.currentTime;
    this.art.track = track;
    this.art.el.loop = false;
    this.art.el.src = track.url;
    this.art.gain.gain.setValueAtTime(trackGain(track), now);
    ramp(this.duck.gain, now, c.BGM_DUCK_LEVEL, c.BGM_DUCK_IN_SEC);
    void this.art.el.play().catch(() => undefined);
  }

  stopArtwork(): void {
    if (!this.art) return;
    this.art.el.pause();
    this.onArtworkEnded();
  }

  /** `소리` 버튼(켬/끔). 값은 화면이 기기에 기억한다. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) ramp(this.master.gain, this.ctx.currentTime, muted ? 0 : 1, 0.2);
  }

  /** 화면 잠금·앱 전환에서 돌아오면 `interrupted`·`suspended`일 수 있다(PLAN §8.3). */
  async resumeIfNeeded(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        // 다음 누름에서 unlock()이 다시 시도한다.
      }
    }
  }

  snapshot(): AudioSnapshot {
    return {
      context: this.ctx?.state ?? 'none',
      unlocked: this.unlocked,
      master: this.master?.gain.value ?? 0,
      duck: this.duck?.gain.value ?? 0,
      slots: (this.slots ?? []).map(s => ({
        id: s.track?.id ?? null,
        gain: s.gain.gain.value,
        paused: s.el.paused,
      })),
      artwork: { id: this.art?.track?.id ?? null, paused: this.art?.el.paused ?? true },
    };
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    for (const s of [...(this.slots ?? []), ...(this.art ? [this.art] : [])]) {
      s.el.pause();
      s.el.removeAttribute('src');
    }
    void this.ctx?.close();
    this.ctx = null;
  }

  private build(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);
    const duck = ctx.createGain();
    duck.connect(master);
    const makeSlot = (out: AudioNode): Slot => {
      const el = new Audio();
      el.preload = 'none';
      el.crossOrigin = 'anonymous';
      el.setAttribute('playsinline', '');
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(out);
      return { el, gain, track: null };
    };
    this.ctx = ctx;
    this.master = master;
    this.duck = duck;
    this.slots = [makeSlot(duck), makeSlot(duck)];
    this.art = makeSlot(master);
    const onEnded = () => this.onArtworkEnded();
    this.art.el.addEventListener('ended', onEnded);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.resumeIfNeeded();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.cleanups.push(
      () => this.art?.el.removeEventListener('ended', onEnded),
      () => document.removeEventListener('visibilitychange', onVisible),
    );
  }

  private onArtworkEnded(): void {
    if (!this.ctx || !this.duck || !this.art) return;
    this.art.track = null;
    ramp(this.duck.gain, this.ctx.currentTime, 1, config().BGM_DUCK_OUT_SEC);
  }
}

const trackGain = (track: Track): number => {
  const limit = config().AUDIO_GAIN_LIMIT_DB;
  const db = Math.max(-limit, Math.min(limit, track.gainDb ?? 0));
  return dbToGain(db);
};

/**
 * 등전력 곡선(투어·전시실 교차 공통, ADR-046). 지금 값에서 이어서 시작하므로 교차 중에 다시 불러도 튀지 않는다.
 * `setValueCurveAtTime`은 진행 중인 곡선과 겹치면 예외를 내므로 직선 경사 여러 개로 나눠 예약한다.
 */
const fadeCurve = (slot: Slot, now: number, seconds: number, dir: 'in' | 'out', peak: number): void => {
  const param = slot.gain.gain;
  const from = param.value;
  const span = Math.max(0.01, seconds);
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  for (let i = 1; i <= CURVE_POINTS; i++) {
    const p = i / CURVE_POINTS;
    const value = dir === 'in' ? from + (peak - from) * equalPowerIn(p) : from * equalPowerOut(p);
    param.linearRampToValueAtTime(value, now + p * span);
  }
};

const ramp = (param: AudioParam, now: number, to: number, seconds: number): void => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
};

/** 사용자 동작 안에서 요소를 한 번 재생해 둔다(그 뒤로는 코드로 재생 가능). 약속이 거절되면 false. */
const primeElement = async (el: HTMLAudioElement, silentUrl: string): Promise<boolean> => {
  const hadSrc = el.getAttribute('src');
  if (!hadSrc) el.src = silentUrl;
  el.muted = true;
  try {
    await el.play();
    el.pause();
    return true;
  } catch {
    return false;
  } finally {
    el.muted = false;
    if (!hadSrc) el.removeAttribute('src');
  }
};

/** iOS 17+: 무음 스위치를 켜 둔 iPad에서도 들리게(Safari 16.4+ API, F-2). 없으면 아무것도 안 함. */
const setPlaybackSession = (): void => {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
};

let silentUrlCache: string | null = null;
/** 0.1초 무음 WAV(자체 생성 — 외부 파일·출처 없음, CSP `media-src blob:`). */
const silentWavUrl = (): string => {
  if (silentUrlCache) return silentUrlCache;
  const rate = 8000;
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples);
  const v = new DataView(buffer);
  const text = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  silentUrlCache = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  return silentUrlCache;
};
