import { config } from '@gallery/core/config';
import type { Peer, Pose } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { JUMP_IDLE, jumpBody } from '../walk/jumpPose.ts';
import { Walker, type WalkInput } from '../walk/walker.ts';
import { PeerBuffer, peerJumpAt, peerJumpSpanSec, splitVisible, visibleMaxFor } from './peerBuffer.ts';

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

describe('남의 점프(PRD_V2 W-05)', () => {
  const D = config().LIVE_INTERP_DELAY_MS;
  const still: WalkInput = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };

  it('원격 곡선은 내 걷기 엔진(60Hz) 곡선과 2cm 안이고 몸 배율도 같다', () => {
    const walk = testExhibitionView([3]).layout.walk;
    const w = new Walker(walk, { x: walk.spawn.pos[0], z: walk.spawn.pos[2], yaw: 0 });
    expect(w.jump()).toBe(true);
    const dt = 1 / 60;
    let worst = 0;
    let top = 0;
    let mineFrames = 0;
    let remoteFrames = 0;
    for (let k = 1; k <= 60; k++) {
      w.step(dt, still);
      const mine = w.pose;
      const remote = peerJumpAt(k * dt);
      if (mine.jump.phase !== 'idle') mineFrames++;
      if (remote) remoteFrames++;
      worst = Math.max(worst, Math.abs((remote?.air ?? 0) - mine.air));
      top = Math.max(top, remote?.air ?? 0);
      // 몸 모양: 단계 경계는 부동소수 반올림으로 한쪽만 넘을 수 있어 단계 이름 대신 배율로 본다. 착지는 한 프레임 안에서
      // 갈려 착지 눌림·되튐 시각만 조금 다르다(끝난 쪽은 제 모양)
      const a = jumpBody(remote ? remote.state : JUMP_IDLE);
      const b = jumpBody(mine.jump);
      expect(Math.abs(a.sy - b.sy)).toBeLessThan(0.03);
      expect(Math.abs(a.sxz - b.sxz)).toBeLessThan(0.03);
      expect(Math.abs(a.tuck - b.tuck)).toBeLessThan(0.1);
    }
    expect(worst).toBeLessThanOrEqual(0.02);
    const c = config();
    expect(top).toBeCloseTo(c.CHAR_JUMP_SPEED_MPS ** 2 / (2 * c.CHAR_GRAVITY_MPS2), 1);
    // 웅크림부터 되튐 끝까지 걷기 엔진과 같은 길이(한 프레임 안)
    expect(Math.abs(mineFrames - remoteFrames)).toBeLessThanOrEqual(1);
    expect(Math.abs(remoteFrames * dt - peerJumpSpanSec())).toBeLessThanOrEqual(dt);
    expect(peerJumpAt(peerJumpSpanSec() + 0.001)).toBeNull();
  });

  it('jump를 받으면 위치처럼 늦춘 시각에 경과 시간을 내고, 그동안 높이 = 바닥 + 포물선(공중 y 표본은 빼고)', () => {
    const b = new PeerBuffer();
    // 서버 시각 = 기기 시각 + 1000
    b.apply(
      { t: 'welcome', you: 'me000001', nickname: '하늘', peers: [peer('aaaaaaaa', pose(0, 0))], at: 11_000 },
      10_000,
    );
    b.apply({ t: 'jump', sid: 'aaaaaaaa', at: 11_500 }, 10_500);
    // 공중에서 보낸 위치(y 0.4)와 내려앉은 위치(y 0) — 5Hz 표본을 선형으로 이으면 뭉툭하다
    b.apply(
      { t: 'peers', at: 11_800, poses: [{ sid: 'aaaaaaaa', pose: { ...pose(0.3, 0), y: 0.4 } }] },
      10_800,
    );
    b.apply({ t: 'peers', at: 12_200, poses: [{ sid: 'aaaaaaaa', pose: pose(0.6, 0, 0, 0) }] }, 11_200);
    const at = (serverMs: number) => b.sample(serverMs - 1000 + D)[0]!;
    expect(at(11_499).jump).toBeNull();
    expect(at(11_499).air).toBe(0);
    expect(b.busy(11_499 - 1000 + D)).toBe(true); // 곧 시작할 점프
    const mid = at(11_500 + 400);
    expect(mid.jump).toBeCloseTo(0.4, 6);
    expect(mid.air).toBeCloseTo(peerJumpAt(0.4)!.air, 9);
    expect(mid.y).toBeCloseTo(mid.air, 9);
    // 가로 자리는 위치 보간 그대로
    expect(mid.x).toBeCloseTo(0.3 + (0.3 * 100) / 400, 6);
    // 연출이 끝나도 공중 y 표본은 높이에 끼지 않는다
    const after = at(11_500 + peerJumpSpanSec() * 1000 + 10);
    expect(after.jump).toBeNull();
    expect(after.air).toBe(0);
    expect(after.y).toBe(0);
    expect(b.busy(11_500 + peerJumpSpanSec() * 1000 + 10 - 1000 + D)).toBe(false);
    // 모르는 사람(또는 나)의 점프는 버린다
    b.apply({ t: 'jump', sid: 'zzzzzzzz', at: 11_600 }, 10_600);
    expect(b.size).toBe(1);
  });

  it('공중 중에 온 다음 점프는 착지 뒤로 미루고, 오래된 점프는 잊는다(그 뒤 높이는 다시 보간)', () => {
    const b = new PeerBuffer();
    b.apply(
      { t: 'welcome', you: 'me000001', nickname: '하늘', peers: [peer('aaaaaaaa', pose(0, 0))], at: 1000 },
      1000,
    );
    b.apply({ t: 'jump', sid: 'aaaaaaaa', at: 1500 }, 1500);
    // 서버 도착이 흔들려 두 번째가 0.2초 뒤에 왔다(기기에서는 착지 뒤에 눌렀음)
    b.apply({ t: 'jump', sid: 'aaaaaaaa', at: 1700 }, 1700);
    expect(b.sample(1500 + 400 + D)[0]!.jump).toBeCloseTo(0.4, 6);
    // 누른 순간부터 다시 땅에 닿을 때까지 = 연출 전체 − 착지 눌림 − 되튐
    const q = config().CHAR_JUMP_SQUASH;
    const airborne = peerJumpSpanSec() - q.landSec - q.reboundSec;
    const second = 1500 + airborne * 1000;
    expect(b.sample(second + 50 + D)[0]!.jump).toBeCloseTo(0.05, 6);
    // 마지막 표본이 공중 y인 채로 남은 경우: 점프를 적어 둔 동안은 바닥, 잊은 뒤에는 표본 그대로
    b.apply({ t: 'peers', at: 2700, poses: [{ sid: 'aaaaaaaa', pose: { ...pose(0, 0), y: 0.3 } }] }, 2700);
    expect(b.sample(second + 1500 + D)[0]!.y).toBe(0);
    expect(b.sample(second + 2000 + D)[0]!.y).toBeCloseTo(0.3, 9);
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
      jump: null,
      air: 0,
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
