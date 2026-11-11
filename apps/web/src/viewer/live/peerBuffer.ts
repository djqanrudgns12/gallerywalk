import { config } from '@gallery/core/config';
import type { CharacterId, LiveServerMessage, MoveState, Peer, Pose } from '@gallery/core/types';

/**
 * 다른 관람객 자리(ADR-057). 서버 방송(초당 `LIVE_BROADCAST_HZ`)을 받아 두었다가 `LIVE_INTERP_DELAY_MS`만큼 늦은 시각을
 * 두 방송 사이에서 보간한다 — 띄엄띄엄 오는 위치가 부드럽게 걷는다. 서버 시각과 기기 시각의 차이는 받은 순간마다
 * (가장 빨리 도착한 것 기준으로) 추정한다. three에 기대지 않는 순수 클래스.
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
}

const KEEP = 6;
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
      });
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
    for (const e of this.peers.values()) {
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
      out.push({
        sid: e.sid,
        nickname: e.nickname,
        role: e.role,
        character: e.character,
        x: from.pose.x + (to.pose.x - from.pose.x) * u,
        y: from.pose.y + (to.pose.y - from.pose.y) * v,
        z: from.pose.z + (to.pose.z - from.pose.z) * u,
        yaw: lerpAngle(from.pose.yaw, to.pose.yaw, v),
        move: to.pose.move,
        speed: to.pose.move === 0 ? 0 : speed,
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
