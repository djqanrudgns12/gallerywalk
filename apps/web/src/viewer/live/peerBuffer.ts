import { config } from '@gallery/core/config';
import type { CharacterId, LiveServerMessage, MoveState, Peer, Pose } from '@gallery/core/types';
import { type JumpState, jumpStart, stepJump } from '../walk/jumpPose.ts';

/**
 * 다른 관람객 자리(ADR-057). 서버 방송(초당 `LIVE_BROADCAST_HZ`)을 받아 두었다가 `LIVE_INTERP_DELAY_MS`만큼 늦은 시각을
 * 두 방송 사이에서 보간한다 — 띄엄띄엄 오는 위치가 부드럽게 걷는다. 서버 시각과 기기 시각의 차이는 받은 순간마다
 * (가장 빨리 도착한 것 기준으로) 추정한다. three에 기대지 않는 순수 클래스.
 *
 * 남의 점프(PRD_V2 W-05): 서버가 넘긴 `jump`(받은 시각 `at`, 위치와 같은 서버 시계)를 사람마다 적어 두고, 위치와 같은 늦춘
 * 시각으로 그 순간부터 내 걷기 엔진과 같은 포물선(`peerJumpAt`)을 그린다. 5Hz 표본의 y는 체공 0.5초에 2~3개뿐이라 뭉툭하므로
 * 점프 앞뒤 표본(공중 y가 섞였을 수 있는 것)은 높이 보간에서 빼고, 바닥 높이(땅 표본끼리 보간) + 포물선으로 둔다.
 */

interface Sample {
  readonly at: number;
  readonly pose: Pose;
}

interface Entry {
  readonly sid: string;
  nickname: string;
  role: Peer['role'];
  character: CharacterId;
  samples: Sample[];
  /** 점프 시작(서버 시각 ms, 오래된 것부터) */
  jumps: number[];
}

export interface PeerView {
  readonly sid: string;
  readonly nickname: string;
  readonly role: Peer['role'];
  readonly character: CharacterId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly move: MoveState;
  /** 두 방송 사이 거리로 잰 걷는 빠르기(m/s, 걸음 흔들기용) */
  readonly speed: number;
  /** 점프를 누른 뒤 지난 시간(s, 늦춘 시각 기준) — 점프 연출(웅크림~되튐) 중이 아니면 null */
  readonly jump: number | null;
  /** 바닥 위 높이(m, 점프 포물선 — `y`에 이미 더해 있음). 발밑 그늘은 `y − air` */
  readonly air: number;
}

/** 사람마다 적어 두는 점프 수(체공 중 다시 못 뛰므로 넉넉함) */
const JUMP_KEEP = 4;
const MS_PER_SEC = 1000;

export interface PeerJump {
  /** 바닥 위 높이(m) */
  readonly air: number;
  /** 몸 연출 단계(`jumpBody`에 넘김) */
  readonly state: JumpState;
}

/** 웅크림 끝(뜨는 순간)부터 내려앉을 때까지(s): 2v/g — 내 걷기 엔진도 같은 해석식이라 화면 빈도와 상관없이 같다 */
const flightSec = (): number => {
  const c = config();
  return (2 * c.CHAR_JUMP_SPEED_MPS) / c.CHAR_GRAVITY_MPS2;
};

/** 누른 순간부터 다시 땅에 닿을 때까지(s) — 이 동안은 다시 뛰지 못한다 */
const airborneSec = (): number => config().CHAR_JUMP_SQUASH.crouchSec + flightSec();

/** 점프 연출 전체(s): 웅크림 + 체공 + 착지 눌림 + 되튐 */
export const peerJumpSpanSec = (): number => {
  const q = config().CHAR_JUMP_SQUASH;
  return airborneSec() + q.landSec + q.reboundSec;
};

/**
 * 누른 뒤 `e`초의 높이와 몸 단계 — 내 걷기 엔진(`Walker.stepAir` + `jumpPose`)과 같은 수치(`CHAR_JUMP_SPEED_MPS`·
 * `CHAR_GRAVITY_MPS2`·`CHAR_JUMP_SQUASH`). 웅크림 동안은 땅, 뜬 뒤 τ초는 v·τ − g·τ²/2. 연출이 끝났으면 null
 */
export const peerJumpAt = (e: number): PeerJump | null => {
  if (!(e >= 0)) return null;
  const c = config();
  const flight = flightSec();
  const tau = e - c.CHAR_JUMP_SQUASH.crouchSec;
  if (tau < flight) {
    const v = c.CHAR_JUMP_SPEED_MPS;
    const air = tau > 0 ? Math.max(0, v * tau - (c.CHAR_GRAVITY_MPS2 * tau * tau) / 2) : 0;
    return { air, state: stepJump(jumpStart(), e, false) };
  }
  const state = stepJump({ phase: 'land', t: 0 }, tau - flight, false);
  return state.phase === 'idle' ? null : { air: 0, state };
};

/** 사람마다 남기는 표본 수(5Hz로 2초 — 점프 앞 땅 표본이 공중 표본에 밀려나지 않게) */
const KEEP = 10;
/** 마지막 방송 뒤 이만큼까지만 앞으로 늘린다(끊기면 그 자리에 선다) */
const EXTRAPOLATE_MS = 250;

const lerpAngle = (a: number, b: number, t: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

export class PeerBuffer {
  private readonly peers = new Map<string, Entry>();
  /** 서버 시각 − 기기 시각(ms). 가장 작은 지연을 본 값으로 */
  private offset: number | null = null;
  private me: string | null = null;

  get size(): number {
    return this.peers.size;
  }

  get you(): string | null {
    return this.me;
  }

  clear(): void {
    this.peers.clear();
    this.offset = null;
    this.me = null;
  }

  private clock(serverAt: number, receivedAt: number): void {
    const o = serverAt - receivedAt;
    // 늦게 도착한 것일수록 o가 작다 → 가장 큰 o가 지연이 가장 짧은 것
    this.offset = this.offset === null ? o : Math.max(this.offset, o);
  }

  private upsert(p: Peer, at: number): void {
    if (p.sid === this.me) return;
    const e = this.peers.get(p.sid);
    if (e) {
      e.nickname = p.nickname;
      e.role = p.role;
      e.character = p.character;
      this.push(e, at, p.pose);
    } else
      this.peers.set(p.sid, {
        sid: p.sid,
        nickname: p.nickname,
        role: p.role,
        character: p.character,
        samples: [{ at, pose: p.pose }],
        jumps: [],
      });
  }

  /** 점프 시작 하나(서버 시각). 앞 점프가 아직 공중이면(서버 도착 흔들림) 그 착지 뒤로 미룬다 — 포물선이 끊기지 않게 */
  private addJump(e: Entry, at: number): void {
    const last = e.jumps[e.jumps.length - 1];
    const start = last === undefined ? at : Math.max(at, last + airborneSec() * MS_PER_SEC);
    e.jumps.push(start);
    if (e.jumps.length > JUMP_KEEP) e.jumps.splice(0, e.jumps.length - JUMP_KEEP);
  }

  /**
   * 다 지나 높이 보간에도 더는 끼지 않는 점프를 버린다(`t` = 늦춘 서버 시각). 섞인 창이 끝난 뒤 `config().PEER_JUMP_TAINT_MS`를 더 두는 것은
   * 높이 보간의 앞 표본이 창 밖으로 나올 때까지(표본 간격 ≤ 그 값)
   */
  private forgetJumps(e: Entry, t: number): void {
    const keep = airborneSec() * MS_PER_SEC + config().PEER_JUMP_TAINT_MS * 2;
    while (e.jumps.length > 0 && t - e.jumps[0]! > keep) e.jumps.shift();
  }

  /** 공중 y가 섞였을 수 있는 표본인가: 점프 시작 뒤 ~ 착지 + `config().PEER_JUMP_TAINT_MS` 안에 서버가 낸 것 */
  private tainted(e: Entry, at: number): boolean {
    const span = airborneSec() * MS_PER_SEC + config().PEER_JUMP_TAINT_MS;
    for (const j of e.jumps) if (at > j && at <= j + span) return true;
    return false;
  }

  /** 바닥 높이: 땅 표본끼리만 `t`에서 보간(앞뒤 하나뿐이면 그것, 모두 섞였으면 가장 낮은 것) */
  private groundY(e: Entry, t: number): number {
    let before: Sample | undefined;
    let after: Sample | undefined;
    let lowest = Number.POSITIVE_INFINITY;
    for (const s of e.samples) {
      lowest = Math.min(lowest, s.pose.y);
      if (this.tainted(e, s.at)) continue;
      if (s.at <= t) before = s;
      else if (!after) after = s;
    }
    if (before && after)
      return (
        before.pose.y + ((after.pose.y - before.pose.y) * (t - before.at)) / Math.max(1, after.at - before.at)
      );
    const one = before ?? after;
    return one ? one.pose.y : lowest;
  }

  private push(e: Entry, at: number, pose: Pose): void {
    const last = e.samples[e.samples.length - 1];
    if (last && at <= last.at) return; // 늦게 온 옛 위치
    e.samples.push({ at, pose });
    if (e.samples.length > KEEP) e.samples.splice(0, e.samples.length - KEEP);
  }

  /** 서버 메시지 하나 반영. `receivedAt` = 기기 시각(ms) */
  apply(msg: LiveServerMessage, receivedAt: number): void {
    switch (msg.t) {
      case 'welcome':
        this.clear();
        this.me = msg.you;
        this.clock(msg.at, receivedAt);
        for (const p of msg.peers) this.upsert(p, msg.at);
        return;
      case 'peers':
        this.clock(msg.at, receivedAt);
        for (const { sid, pose } of msg.poses) {
          const e = this.peers.get(sid);
          if (e) this.push(e, msg.at, pose);
        }
        return;
      case 'join':
        this.upsert(msg.peer, this.offset === null ? receivedAt : receivedAt + this.offset);
        return;
      case 'leave':
        this.peers.delete(msg.sid);
        return;
      case 'jump': {
        // 서버가 받은 즉시 넘긴 것이라 위치처럼 시계 추정에도 쓴다
        this.clock(msg.at, receivedAt);
        const e = this.peers.get(msg.sid);
        if (e) this.addJump(e, msg.at);
        return;
      }
      case 'bye':
        this.clear();
        return;
    }
  }

  /**
   * 아직 움직임이 남았는가: 보간 시각이 누군가의 마지막 표본보다 앞이거나(두 방송 사이) 늘리는 중이면 true —
   * 걸음 흔들기와 상관없이 자리·방향이 바뀌는 동안은 다시 그려야 한다(회전만 하는 경우 포함).
   */
  busy(now: number): boolean {
    const t = (this.offset === null ? now : now + this.offset) - config().LIVE_INTERP_DELAY_MS;
    const span = peerJumpSpanSec() * MS_PER_SEC;
    for (const e of this.peers.values()) {
      // 아직 시작하지 않았거나 연출 중인 점프
      for (const j of e.jumps) if (t < j + span) return true;
      const last = e.samples[e.samples.length - 1];
      if (!last) continue;
      if (t < last.at) return true;
      if (last.pose.move !== 0 && t - last.at <= EXTRAPOLATE_MS) return true;
    }
    return false;
  }

  /** 기기 시각 `now`에 보일 자리들 */
  sample(now: number): PeerView[] {
    const t = (this.offset === null ? now : now + this.offset) - config().LIVE_INTERP_DELAY_MS;
    const out: PeerView[] = [];
    for (const e of this.peers.values()) {
      const s = e.samples;
      if (s.length === 0) continue;
      // a = t 이전의 마지막 표본, b = 그다음(없으면 a 앞의 것에서 짧게 늘린다)
      let k = -1;
      for (let i = 0; i < s.length; i++) if (s[i]!.at <= t) k = i;
      let from: Sample;
      let to: Sample;
      let u: number;
      if (k === -1) {
        from = s[0]!;
        to = s[0]!;
        u = 0;
      } else if (k < s.length - 1) {
        from = s[k]!;
        to = s[k + 1]!;
        u = (t - from.at) / Math.max(1, to.at - from.at);
      } else if (k > 0) {
        from = s[k - 1]!;
        to = s[k]!;
        // 멈춘 표본(move 0) 뒤로는 늘리지 않는다 — 그 자리에 선다(Codex 검토 P2)
        u = to.pose.move === 0 ? 1 : 1 + Math.min(EXTRAPOLATE_MS, t - to.at) / Math.max(1, to.at - from.at);
      } else {
        from = s[k]!;
        to = s[k]!;
        u = 0;
      }
      const span = Math.max(1, to.at - from.at) / 1000;
      const stale = t - s[s.length - 1]!.at > EXTRAPOLATE_MS;
      const speed =
        from === to || stale ? 0 : Math.hypot(to.pose.x - from.pose.x, to.pose.z - from.pose.z) / span;
      const v = Math.min(1, u);
      this.forgetJumps(e, t);
      // 지금 재생할 점프 = 시작이 t 이전인 마지막 것
      let jumpAt: number | undefined;
      for (const j of e.jumps) if (j <= t) jumpAt = j;
      const jump = jumpAt === undefined ? null : peerJumpAt((t - jumpAt) / MS_PER_SEC);
      const air = jump ? jump.air : 0;
      out.push({
        sid: e.sid,
        nickname: e.nickname,
        role: e.role,
        character: e.character,
        x: from.pose.x + (to.pose.x - from.pose.x) * u,
        // 점프 앞뒤면 보간 y 대신 바닥 높이 + 포물선
        y: e.jumps.length > 0 ? this.groundY(e, t) + air : from.pose.y + (to.pose.y - from.pose.y) * v,
        z: from.pose.z + (to.pose.z - from.pose.z) * u,
        yaw: lerpAngle(from.pose.yaw, to.pose.yaw, v),
        move: to.pose.move,
        speed: to.pose.move === 0 ? 0 : speed,
        jump: jumpAt !== undefined && jump ? (t - jumpAt) / MS_PER_SEC : null,
        air,
      });
    }
    return out;
  }
}

/** 가까운 순으로 `max`명은 온몸, 나머지는 이름표만(그리기 예산, ADR-057) */
export const splitVisible = (
  peers: readonly PeerView[],
  me: { x: number; z: number },
  max: number,
): { full: PeerView[]; tags: PeerView[] } => {
  const sorted = [...peers].sort(
    (p, q) =>
      Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z) || (p.sid < q.sid ? -1 : 1),
  );
  return { full: sorted.slice(0, max), tags: sorted.slice(max) };
};

/** 화면 크기 → 온몸으로 그릴 수(휴대폰·태블릿·데스크톱) */
export const visibleMaxFor = (shortSidePx: number, touch: boolean): number => {
  const c = config().LIVE_VISIBLE_MAX;
  if (!touch) return c.desktop;
  return shortSidePx < 600 ? c.phone : c.tablet;
};
