import { config } from '@gallery/core/config';
import { equalPowerGain, type TourPlan } from '@gallery/core/tour';

/**
 * 자동 투어 소리 이음(P5-9, PLAN §6.13 "소리 이음 — 자동 페이드인·페이드아웃", ADR-046).
 *
 * `songsAt(plan, t)`는 순수 함수: 시각 t에 들려야 할 곡들(겹치는 1초 동안은 둘)과 곡 안 재생 위치·음량.
 * `TourSoundtrack`은 얇은 재생기: 매 프레임 그 목록에 미디어 요소 두 개를 맞춘다(위치가 `DRIFT_SEC` 넘게
 * 어긋나면 다시 맞춤). 멈춤·건너뛰기·되감기는 카메라(`tourCamera`)와 같은 t 하나로 맞춰진다.
 * 조작 페이드(Space 0.4초·→ 1.2초·Esc 1.5초)는 전체 음량(`master`)에 걸어 곡 계획과 섞지 않는다.
 */

export interface SongState {
  readonly roomId: string;
  /** 곡 파일 안 재생 위치(초) */
  readonly positionSec: number;
  /** 선형 음량(등전력 페이드 × 곡 크기 맞추기 이득) */
  readonly gain: number;
}

const dbToGain = (db: number): number => 10 ** (db / 20);

export const songsAt = (plan: TourPlan, t: number): SongState[] => {
  const out: SongState[] = [];
  for (const room of plan.rooms) {
    const s = room.song;
    if (!s || t < s.startSec || t >= s.endSec) continue;
    const positionSec = s.fromMs / 1000 + (t - s.startSec);
    if (positionSec >= s.toMs / 1000) continue; // 곡이 끝났으면 남은 시간은 조용히(되풀이하지 않음)
    let env = 1;
    if (t < s.fadeInEndSec)
      env = equalPowerGain('IN', (t - s.startSec) / Math.max(1e-6, s.fadeInEndSec - s.startSec));
    if (t >= s.fadeOutStartSec)
      env = Math.min(
        env,
        equalPowerGain('OUT', (t - s.fadeOutStartSec) / Math.max(1e-6, s.endSec - s.fadeOutStartSec)),
      );
    out.push({ roomId: room.roomId, positionSec, gain: env * dbToGain(s.gainDb) });
  }
  return out;
};

/** 위치가 이만큼 넘게 어긋나면 다시 맞춘다(미디어 요소의 자연스러운 흔들림은 넘기지 않음) */
const DRIFT_SEC = 0.3;

export interface SoundtrackSources {
  /** 전시실 ID → 곡 주소 */
  readonly urlOf: (roomId: string) => string | null;
}

/**
 * 재생기: Web Audio 그래프(요소 2개 → 각자 GainNode → master → 출력). iOS는 요소 음량을 무시하므로 GainNode로(ADR-011).
 * 잠금 풀기(사용자 몸짓 안에서 `AudioContext.resume`)는 투어 시작 버튼이 `AudioEngine.unlock()`으로 먼저 한다.
 */
export class TourSoundtrack {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly slots: { el: HTMLAudioElement; gain: GainNode; roomId: string | null }[];
  private readonly plan: TourPlan;
  private readonly sources: SoundtrackSources;

  constructor(ctx: AudioContext, plan: TourPlan, sources: SoundtrackSources) {
    this.ctx = ctx;
    this.plan = plan;
    this.sources = sources;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.slots = [0, 1].map(() => {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.master);
      return { el, gain, roomId: null };
    });
  }

  /** 투어 시각 t에 맞춘다(매 프레임). `playing`이 거짓이면 멈춘 채 위치만 맞춤 */
  sync(t: number, playing: boolean): void {
    const want = songsAt(this.plan, t);
    // 이미 그 곡을 들고 있는 요소는 그대로, 나머지는 빈 요소에
    for (const slot of this.slots) if (!want.some(w => w.roomId === slot.roomId)) this.release(slot);
    for (const w of want) {
      const slot = this.slots.find(s => s.roomId === w.roomId) ?? this.slots.find(s => s.roomId === null);
      if (!slot) continue;
      if (slot.roomId !== w.roomId) {
        const url = this.sources.urlOf(w.roomId);
        if (!url) continue;
        slot.roomId = w.roomId;
        slot.el.src = url;
        slot.el.currentTime = w.positionSec;
      } else if (Math.abs(slot.el.currentTime - w.positionSec) > DRIFT_SEC)
        slot.el.currentTime = w.positionSec;
      slot.gain.gain.setTargetAtTime(w.gain, this.ctx.currentTime, 0.02);
      if (playing && slot.el.paused) void slot.el.play().catch(() => undefined);
      if (!playing && !slot.el.paused) slot.el.pause();
    }
  }

  /** 조작 페이드: 전체 음량을 `seconds` 동안 0(또는 1)으로(§6.13 Space·→·Esc) */
  fadeMaster(to: 0 | 1, seconds: number): void {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
  }

  /** 조작별 페이드 시간(설정) */
  static fades() {
    const c = config();
    return {
      pause: c.TOUR_PAUSE_FADE_SEC,
      resume: c.TOUR_RESUME_FADE_SEC,
      skip: c.TOUR_SKIP_FADE_SEC,
      end: c.TOUR_END_FADE_SEC,
    };
  }

  dispose(): void {
    for (const s of this.slots) this.release(s);
    this.master.disconnect();
  }

  private release(slot: { el: HTMLAudioElement; gain: GainNode; roomId: string | null }): void {
    if (slot.roomId === null) return;
    slot.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    slot.el.pause();
    slot.el.removeAttribute('src');
    slot.el.load();
    slot.roomId = null;
  }
}
