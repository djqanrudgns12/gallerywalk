import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { type Rng, ShuffleBag } from './shuffleBag.ts';
import { docentTuning } from './tuning.ts';

/**
 * 도슨트 한 명의 행동(PRD_V2 W-10, M4-7). 순수: 시각(초)·내 자리를 받아 바라볼 각·손짓·끄덕임·대사를 낸다. 난수는 주입.
 * - 바라보기: 내가 `NPC_LOOK_RADIUS_M` 안이면 나를 향해 몸을 `NPC_LOOK_MAX_DEG`까지 돌리고, 넘는 만큼은 고개만(`headMaxDeg`까지).
 *   밖이면 쉬는 방향으로 돌아온다. 빠르기는 `NPC_TURN_RAD_PER_S`(고개는 `headTurnGain`배라 고개가 먼저 돌고 몸이 따라온다).
 * - 손짓: 내가 바라보기 반지름 안으로 새로 들어오고 도슨트가 내 앞쪽(`NPC_TALK_ARC_DEG`)이면 손 흔들기(인사,
 *   `CHAR_GREET_COOLDOWN_SEC`에 한 번). 말걸기를 받으면 안내 손짓. 길이는 둘 다 `CHAR_WAVE_SEC`.
 * - 끄덕임: 말을 시작할 때(한마디·말걸기) `nod.count`번.
 * - 이따금 한마디: `NPC_TIP_RADIUS_M` 안에 있으면 `NPC_TIP_SEC` 무작위 간격(시작 사이)으로 `NPC_TIP_SHOW_SEC` 동안.
 *   말걸기 대사가 떠 있으면 그 뒤로 미룬다. 반지름 밖으로 나가면 지우고 간격을 새로 잰다.
 * - 말걸기: 부를 때마다 주머니의 다음 줄을 `NPC_TALK_SHOW_SEC` 동안. `NPC_TALK_RADIUS_M` 밖으로 멀어지거나 걸으면 닫는다
 *   (걸으면서 누른 경우는 한 번 멈춘 뒤 다시 걸을 때 닫는다 — 누르자마자 깜빡 닫히지 않게).
 * - 한마디와 말걸기는 주머니 하나를 함께 쓴다: 한마디 바로 뒤 말걸기가 같은 줄을 되풀이하지 않고, 한 바퀴 안에서는 두 길을 합쳐 겹치지 않는다.
 * - 동작 줄이기(`calm`): 손짓·끄덕임 없이 몸·고개는 바로 돌아선다. 대사가 떠 있어도 스스로 다시 그리기를 부르지 않는다.
 */

export type DocentKind = 'plaza' | 'hall' | 'room';

/** 도슨트 자리 ID → 대사 묶음 종류(`copy.museumDocent.zones`). 모르는 ID는 null */
export const docentKindOf = (id: string): DocentKind | null => {
  switch (id) {
    case 'docent-plaza':
      return 'plaza';
    case 'docent-hall':
      return 'hall';
    case 'docent-room':
      return 'room';
    default:
      return null;
  }
};

/** 그 도슨트가 쓰는 줄 번호(1부터). 모르는 자리는 모든 줄 */
export const docentLines = (id: string): readonly number[] => {
  const kind = docentKindOf(id);
  return kind ? copy.museumDocent.zones[kind] : copy.museumDocent.lines.map((_, i) => i + 1);
};

/** 줄 번호(1부터) → 대사 */
export const docentLineText = (line: number): string => copy.museumDocent.lines[line - 1] ?? '';

export interface DocentSpot {
  readonly id: string;
  /** 바닥 자리(x, z) */
  readonly pos: readonly [number, number];
  /** 쉬는 방향(rad, 0 = +Z) */
  readonly yaw: number;
}

export interface DocentMe {
  readonly x: number;
  readonly z: number;
  /** 내 몸이 바라보는 방향(rad, 0 = +Z) */
  readonly yaw: number;
}

export interface DocentInput {
  /** 단조 시계(초) */
  readonly now: number;
  /** 내 자리. null이면 아무도 없음(투어·그리지 않는 도슨트) */
  readonly me: DocentMe | null;
  /** 내가 걷는 중인가(손 입력·안내 이동) */
  readonly walking: boolean;
  /** 동작 줄이기 */
  readonly calm: boolean;
}

export type GestureKind = 'wave' | 'guide';

export interface Speech {
  readonly kind: 'tip' | 'talk';
  /** 줄 번호(1부터) */
  readonly line: number;
  /** 시작·끝 시각(초) */
  readonly since: number;
  readonly until: number;
}

export interface DocentOutput {
  /** 몸 방향(세계 rad, 0 = +Z) */
  readonly bodyYaw: number;
  /** 고개 각(몸 기준 rad, + = 왼쪽으로 돎) */
  readonly headYaw: number;
  /** 하는 중인 손짓과 시작 뒤 지난 초 */
  readonly gesture: { readonly kind: GestureKind; readonly t: number } | null;
  /** 끄덕임 시작 뒤 지난 초(안 하면 null) */
  readonly nod: number | null;
  /** 머리 위에 띄울 대사(말걸기가 한마디보다 먼저) */
  readonly speech: Speech | null;
  /** 말걸기 대사(대사 카드) */
  readonly talk: Speech | null;
  /** 스스로 다음 프레임이 필요한가(돌기·손짓·끄덕임·말걸기 대사 중) */
  readonly busy: boolean;
  /** 다음에 한 번 깨워야 할 시각(한마디 시작·대사 끝). 없으면 null */
  readonly wakeAt: number | null;
  /** 나까지 거리(m). 아무도 없으면 Infinity */
  readonly distance: number;
}

const EPS = 1e-6;
const deg = (d: number): number => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur: number, target: number, step: number): number =>
  Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;

/** 끄덕임 길이(초) */
export const nodSec = (): number => docentTuning().nod.count / docentTuning().nod.hz;

export class DocentBrain {
  readonly spot: DocentSpot;
  private readonly bag: ShuffleBag<number>;
  private readonly rng: Rng;
  /** 쉬는 방향 기준 몸 각 · 몸 기준 고개 각 */
  private bodyRel = 0;
  private headRel = 0;
  private last: number | null = null;
  private nextTipAt: number | null = null;
  private tip: Speech | null = null;
  private talkNow: Speech | null = null;
  /** 걸으면서 말걸기를 눌렀다 — 한 번 멈출 때까지는 걷기로 닫지 않는다 */
  private talkWalkExempt = false;
  private gestureNow: { readonly kind: GestureKind; readonly at: number } | null = null;
  private nodAt: number | null = null;
  private wasNear = false;
  private wasWalking = false;
  private lastGreetAt = Number.NEGATIVE_INFINITY;

  constructor(spot: DocentSpot, lines: readonly number[], rng: Rng = Math.random) {
    this.spot = spot;
    this.bag = new ShuffleBag(lines, rng);
    this.rng = rng;
  }

  private interval(): number {
    const { min, max } = config().NPC_TIP_SEC;
    return min + clamp(this.rng(), 0, 1) * (max - min);
  }

  /** 말걸기: 주머니의 다음 줄. 떠 있던 한마디는 지우고, 다음 한마디는 대사가 끝난 뒤로 미룬다 */
  talk(now: number, calm = false): Speech {
    const c = config();
    const s: Speech = { kind: 'talk', line: this.bag.next(), since: now, until: now + c.NPC_TALK_SHOW_SEC };
    this.talkNow = s;
    this.talkWalkExempt = this.wasWalking;
    this.tip = null;
    if (!calm) {
      this.nodAt = now;
      if (!this.gestureNow) this.gestureNow = { kind: 'guide', at: now };
    }
    if (this.nextTipAt !== null && this.nextTipAt < s.until) this.nextTipAt = s.until + this.interval();
    return s;
  }

  /** 말걸기 대사를 닫는다(카드의 닫기) */
  closeTalk(): void {
    this.talkNow = null;
  }

  update(input: DocentInput): DocentOutput {
    const c = config();
    const t = docentTuning();
    const { now, me, walking, calm } = input;
    const dt = this.last === null ? 0 : clamp(now - this.last, 0, t.dtMaxSec);
    this.last = now;
    const dx = me ? me.x - this.spot.pos[0] : 0;
    const dz = me ? me.z - this.spot.pos[1] : 0;
    const d = me ? Math.hypot(dx, dz) : Number.POSITIVE_INFINITY;

    // ── 바라보기 ───────────────────────────────────────────────
    const looking = d <= c.NPC_LOOK_RADIUS_M && d > EPS;
    const rel = looking ? wrapAngle(Math.atan2(dx, dz) - this.spot.yaw) : 0;
    const maxBody = deg(c.NPC_LOOK_MAX_DEG);
    const bodyT = clamp(rel, -maxBody, maxBody);
    const rate = c.NPC_TURN_RAD_PER_S;
    this.bodyRel = calm ? bodyT : approach(this.bodyRel, bodyT, rate * dt);
    // 고개는 몸이 아직 못 돈 만큼까지 먼저 돈다(몸이 따라오면 줄어듦)
    const maxHead = deg(t.headMaxDeg);
    const headT = looking ? clamp(rel - this.bodyRel, -maxHead, maxHead) : 0;
    this.headRel = calm ? headT : approach(this.headRel, headT, rate * t.headTurnGain * dt);
    const turning =
      Math.abs(this.bodyRel - bodyT) > t.settleRad || Math.abs(this.headRel - headT) > t.settleRad;

    // ── 인사(손 흔들기) ─────────────────────────────────────────
    const near = d <= c.NPC_LOOK_RADIUS_M;
    if (me && near && !this.wasNear && !calm && !this.gestureNow) {
      const cooled = now - this.lastGreetAt >= c.CHAR_GREET_COOLDOWN_SEC;
      // 도슨트가 내 앞쪽에 있을 때만(뒤에서 흔들면 보이지 않음)
      const ahead =
        d <= EPS ||
        (Math.sin(me.yaw) * -dx + Math.cos(me.yaw) * -dz) / d >= Math.cos(deg(c.NPC_TALK_ARC_DEG / 2));
      if (cooled && ahead) {
        this.gestureNow = { kind: 'wave', at: now };
        this.lastGreetAt = now;
      }
    }
    this.wasNear = near;

    // ── 말걸기 닫기 ─────────────────────────────────────────────
    if (!walking) this.talkWalkExempt = false;
    if (
      this.talkNow &&
      (now >= this.talkNow.until || d > c.NPC_TALK_RADIUS_M || (walking && !this.talkWalkExempt))
    )
      this.talkNow = null;
    this.wasWalking = walking;

    // ── 이따금 한마디 ────────────────────────────────────────────
    if (d > c.NPC_TIP_RADIUS_M) {
      this.nextTipAt = null;
      this.tip = null;
    } else {
      if (this.tip && now >= this.tip.until) this.tip = null;
      if (this.nextTipAt === null) this.nextTipAt = now + this.interval();
      if (this.talkNow) {
        if (this.nextTipAt < this.talkNow.until) this.nextTipAt = this.talkNow.until + this.interval();
      } else if (!this.tip && now >= this.nextTipAt) {
        this.tip = { kind: 'tip', line: this.bag.next(), since: now, until: now + c.NPC_TIP_SHOW_SEC };
        if (!calm) this.nodAt = now;
        this.nextTipAt = now + this.interval();
      }
    }

    // ── 손짓·끄덕임 끝 ──────────────────────────────────────────
    if (calm) {
      this.gestureNow = null;
      this.nodAt = null;
    }
    if (this.gestureNow && now - this.gestureNow.at >= c.CHAR_WAVE_SEC) this.gestureNow = null;
    if (this.nodAt !== null && now - this.nodAt >= nodSec()) this.nodAt = null;

    let wakeAt: number | null = null;
    for (const at of [this.talkNow?.until, this.tip?.until, this.nextTipAt])
      if (at !== undefined && at !== null && (wakeAt === null || at < wakeAt)) wakeAt = at;

    return {
      bodyYaw: wrapAngle(this.spot.yaw + this.bodyRel),
      headYaw: this.headRel,
      gesture: this.gestureNow ? { kind: this.gestureNow.kind, t: now - this.gestureNow.at } : null,
      nod: this.nodAt === null ? null : now - this.nodAt,
      speech: this.talkNow ?? this.tip,
      talk: this.talkNow,
      busy: turning || this.gestureNow !== null || this.nodAt !== null || (this.talkNow !== null && !calm),
      wakeAt,
      distance: d,
    };
  }
}

/**
 * 그릴 도슨트(PRD_V2 W-10 "보이는 구역의 도슨트만"): 바깥(`exterior`)에서는 광장·현관 구역 도슨트만, 실내에서는 홀 도슨트와
 * 그리는 관(`visibleParts`) 안의 도슨트. 도슨트는 한 구역에 하나라 실내에서도 둘을 넘지 않는다.
 */
export const drawnDocentIds = (
  spots: readonly { readonly id: string; readonly zone: string }[],
  region: string,
  visibleParts: ReadonlySet<string>,
): Set<string> => {
  const outside = region === 'exterior' || region === '';
  const out = new Set<string>();
  for (const s of spots) {
    const outdoor = s.zone === 'plaza' || s.zone === 'portico';
    if (outside ? outdoor : s.zone === 'hall' || (!outdoor && visibleParts.has(s.zone))) out.add(s.id);
  }
  return out;
};
