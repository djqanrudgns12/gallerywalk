import { config } from '@gallery/core/config';
import type { Peer, Pose } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { PeerBuffer, splitVisible, visibleMaxFor } from './peerBuffer.ts';

const pose = (x: number, z: number, yaw = 0, move: Pose['move'] = 1): Pose => ({ x, y: 0, z, yaw, move });
const peer = (sid: string, p: Pose, nickname = '관람객 1'): Peer => ({
  sid,
  nickname,
  role: 'visitor',
  character: 'student-f',
  pose: p,
});

describe('PeerBuffer', () => {
  const D = config().LIVE_INTERP_DELAY_MS;

  it('두 방송 사이를 늦춘 시각으로 보간하고, 내 자신은 빼고 둔다', () => {
    const b = new PeerBuffer();
    // 서버 시각 = 기기 시각 + 1000(지연 0이라고 보고)
    b.apply(
      { t: 'welcome', you: 'me000001', nickname: '하늘', peers: [peer('aaaaaaaa', pose(0, 0))], at: 11_000 },
      10_000,
    );
    b.apply({ t: 'peers', at: 11_200, poses: [{ sid: 'aaaaaaaa', pose: pose(2, 0) }] }, 10_200);
    // 기기 10_000 + D + 100 → 서버 11_100 = 두 방송 한가운데
    const [v] = b.sample(10_000 + D + 100);
    expect(v!.x).toBeCloseTo(1, 6);
    expect(v!.speed).toBeCloseTo(10, 6); // 2m / 0.2s
    expect(b.you).toBe('me000001');
    b.apply({ t: 'join', peer: peer('me000001', pose(9, 9)) }, 10_300);
    expect(b.size).toBe(1);
  });

  it('마지막 방송 뒤에는 짧게만 늘리고 그 자리에 선다, 늦게 온 옛 위치는 버린다', () => {
    const b = new PeerBuffer();
    b.apply(
      { t: 'welcome', you: 'me000001', nickname: '하늘', peers: [peer('aaaaaaaa', pose(0, 0))], at: 1000 },
      1000,
    );
    b.apply({ t: 'peers', at: 1200, poses: [{ sid: 'aaaaaaaa', pose: pose(1, 0) }] }, 1200);
    b.apply({ t: 'peers', at: 1100, poses: [{ sid: 'aaaaaaaa', pose: pose(-5, 0) }] }, 1210);
    const far = b.sample(1200 + D + 5000)[0]!;
    // 250ms만큼 늘림: 1 + 0.25/0.2 = 2.25
    expect(far.x).toBeCloseTo(2.25, 6);
    expect(far.speed).toBe(0);
  });

  it('멈춘 표본(move 0) 뒤로는 늘리지 않고, 보간이 남은 동안 busy(Codex 검토 P2)', () => {
    const b = new PeerBuffer();
    b.apply(
      { t: 'welcome', you: 'me000001', nickname: '하늘', peers: [peer('aaaaaaaa', pose(0, 0))], at: 1000 },
      1000,
    );
    b.apply({ t: 'peers', at: 1200, poses: [{ sid: 'aaaaaaaa', pose: pose(1, 0, 0, 0) }] }, 1200);
    expect(b.busy(1000 + D + 100)).toBe(true); // 두 방송 사이
    expect(b.sample(1000 + D + 100)[0]!.x).toBeCloseTo(0.5, 6);
    expect(b.sample(3000 + D)[0]!.x).toBe(1);
    expect(b.busy(3000 + D)).toBe(false);
  });

  it('떠나면 사라지고, bye면 모두 비운다', () => {
    const b = new PeerBuffer();
    b.apply(
      {
        t: 'welcome',
        you: 'me000001',
        nickname: '하늘',
        peers: [peer('aaaaaaaa', pose(0, 0)), peer('bbbbbbbb', pose(1, 1))],
        at: 0,
      },
      0,
    );
    b.apply({ t: 'leave', sid: 'aaaaaaaa' }, 10);
    expect(b.sample(1000).map(v => v.sid)).toEqual(['bbbbbbbb']);
    b.apply({ t: 'bye', code: 'E_LIVE_FULL' }, 20);
    expect(b.size).toBe(0);
  });
});

describe('보이는 수', () => {
  it('가까운 순으로 상한까지 온몸, 나머지는 이름표', () => {
    const views = [5, 1, 3, 2, 4].map((d, i) => ({
      sid: `p000000${i}`,
      nickname: `n${i}`,
      role: 'visitor' as const,
      character: 'student-m' as const,
      x: d,
      y: 0,
      z: 0,
      yaw: 0,
      move: 0 as const,
      speed: 0,
    }));
    const { full, tags } = splitVisible(views, { x: 0, z: 0 }, 3);
    expect(full.map(v => v.x)).toEqual([1, 2, 3]);
    expect(tags.map(v => v.x)).toEqual([4, 5]);
  });

  it('휴대폰·태블릿·데스크톱 상한', () => {
    const c = config().LIVE_VISIBLE_MAX;
    expect(visibleMaxFor(390, true)).toBe(c.phone);
    expect(visibleMaxFor(820, true)).toBe(c.tablet);
    expect(visibleMaxFor(900, false)).toBe(c.desktop);
  });
});
