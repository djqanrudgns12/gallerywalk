import { config } from '@gallery/core/config';
import { computeLayout, floorAt, footFloorAt, type P2, standable } from '@gallery/core/layout';
import { templateGeometry } from '@gallery/core/templates';
import type { ArtworkForm, LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { cameraSpace, defaultOrbit, followPose } from './followCamera.ts';
import { buildGuideMap, pathBetween, standSpot } from './guide.ts';
import { type MannerInput, type MannerNotice, MannerWatch } from './manners.ts';
import { Walker, type WalkInput, yawOf } from './walker.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const layoutOf = (counts: readonly number[], form: ArtworkForm = 'LANDSCAPE') => {
  const rooms = counts.map((_, r) => ({ id: uuid(900 + r), order: r, hasBgm: false }));
  let k = 0;
  const artworks = counts.flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => ({
      id: uuid(++k),
      roomId: rooms[r]!.id,
      order: i,
      kind: 'IMAGE' as const,
      form,
      featured: false,
      textHeavy: false,
      pixel: { w: 3000, h: 2000 },
      pageCount: null,
    })),
  );
  const input: LayoutInput = {
    exhibitionId: uuid(777),
    templateId: 'modern-history',
    rooms,
    artworks,
    algoVersion: config().ALGO_VERSION,
  };
  return computeLayout(input);
};

const still: WalkInput = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };
const ahead = (cameraYaw = 0, run = false): WalkInput => ({ forward: 1, strafe: 0, run, cameraYaw });

/** dt 1/60로 n초 */
const run = (w: Walker, input: WalkInput, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step(1 / 60, input);
};

describe('Walker', () => {
  const layout = layoutOf([5, 9]);
  const spawn = layout.walk.spawn;

  it('처음 자리는 광장 땅 높이, 앞으로 걸으면 가속해 걷기 속도에 닿는다', () => {
    const w = new Walker(layout.walk, { x: spawn.pos[0], z: spawn.pos[2], yaw: spawn.yaw });
    expect(w.pose.y).toBeCloseTo(layout.exterior.groundY, 6);
    run(w, ahead(), 1);
    expect(w.pose.speed).toBeCloseTo(config().CHAR_WALK_MPS, 2);
    expect(w.pose.move).toBe(1);
    expect(w.pose.z).toBeGreaterThan(spawn.pos[2]);
    run(w, ahead(0, true), 1);
    expect(w.pose.move).toBe(2);
  });

  it('계단을 오르면 디딤판마다 그 디딤판 높이에 서서(파묻히거나 뜨지 않음) 현관 높이(0)에 닿는다', () => {
    // 사용자 의견(2026-11-12): 경사 바닥이라 단 앞에서는 파묻히고 뒤에서는 떠서 걸었다 → 발은 디딤판(`footFloorAt`)
    const e = templateGeometry['modern-history']!.exterior;
    const stairs = layout.walk.areas.find(a => a.slope?.steps)!;
    const top = stairs.slope!.to;
    const w = new Walker(layout.walk, { x: 0, z: spawn.pos[2], yaw: 0 });
    let worst = 0;
    for (let t = 0; t < 12; t += 1 / 60) {
      w.step(1 / 60, ahead());
      // 디딤판 k(위에서 0부터)의 가운데 1/2 구간에 있으면 발 높이 = −k·단 높이
      const fromTop = (top - w.pose.z) / e.stepRunM;
      const k = Math.floor(fromTop);
      const inMiddle = fromTop - k > 0.25 && fromTop - k < 0.75 && k >= 0 && k < e.steps;
      if (inMiddle) worst = Math.max(worst, Math.abs(w.pose.y - -k * e.stepRiseM));
    }
    expect(w.pose.y).toBeCloseTo(0, 2);
    expect(worst).toBeLessThan(0.01);
  });

  it('발 바닥은 디딤판마다 평평하고 카메라 바닥(floorAt)은 경사 그대로다', () => {
    const e = templateGeometry['modern-history']!.exterior;
    const s = layout.walk.areas.find(a => a.slope?.steps)!.slope!;
    expect(s.steps).toBe(e.steps);
    for (let k = 0; k < e.steps; k++) {
      const z = s.to - (k + 0.5) * e.stepRunM;
      expect(footFloorAt(layout.walk, [0, z])).toBeCloseTo(-k * e.stepRiseM, 6);
      // 경사는 디딤판 가운데에서 디딤판과 반 단 차이
      expect(Math.abs(floorAt(layout.walk, [0, z])! - -k * e.stepRiseM)).toBeCloseTo(e.stepRiseM / 2, 6);
    }
    // 계단 아래 끝 너머는 광장 땅
    expect(footFloorAt(layout.walk, [0, s.from - 0.02])).toBeCloseTo(s.y0, 6);
  });

  it('사람끼리: 서 있는 사람 쪽으로 걸어도 몸 반지름 두 배보다 깊이 겹치지 않고 옆으로 비켜 지나간다', () => {
    const c = config();
    const minD = 2 * c.CHAR_BODY_RADIUS_M;
    const other: P2 = [0, -4];
    const w = new Walker(layout.walk, { x: 0.02, z: -7, yaw: 0 });
    w.setCrowd([other]);
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 5; t += 1 / 60) {
      w.step(1 / 60, ahead());
      closest = Math.min(closest, Math.hypot(w.pose.x - other[0], w.pose.z - other[1]));
    }
    // 걷기 빠르기 ÷ 미는 세기만큼만 파고든다(평형)
    expect(closest).toBeGreaterThan(minD - c.CHAR_WALK_MPS / c.CHAR_CROWD_PUSH_PER_S - 0.02);
    expect(w.pose.z).toBeGreaterThan(other[1] + minD * 0.5);
  });

  it('사람끼리: 겹친 채 서 있으면 밀려나 떨어진다(벽은 그대로 막음)', () => {
    const c = config();
    const w = new Walker(layout.walk, { x: 1, z: -6, yaw: 0 });
    w.setCrowd([[1.1, -6]]);
    run(w, still, 1);
    expect(Math.hypot(w.pose.x - 1.1, w.pose.z + 6)).toBeGreaterThan(2 * c.CHAR_BODY_RADIUS_M - 0.01);
    expect(standable(layout.walk, [w.pose.x, w.pose.z])).toBe(true);
  });

  it('벽(걸을 수 있는 곳 밖)으로는 못 가고, 비스듬히 밀면 벽을 따라 미끄러진다', () => {
    // 홀 안에서 뒷벽(−Z) 쪽으로 비스듬히
    const w = new Walker(layout.walk, { x: 3, z: -6, yaw: Math.PI });
    run(w, { forward: 1, strafe: 0, run: false, cameraYaw: Math.PI * 0.85 }, 6);
    const p: P2 = [w.pose.x, w.pose.z];
    expect(standable(layout.walk, p)).toBe(true);
    expect(w.pose.z).toBeGreaterThan(-8 + config().WALKABLE_WALL_MARGIN_M - 1e-6);
    // 미끄러져 x가 바뀌었다
    expect(Math.abs(w.pose.x - 3)).toBeGreaterThan(0.5);
  });

  it('멈추면 감속해 0이 되고 settled', () => {
    const w = new Walker(layout.walk, { x: 0, z: -4, yaw: 0 });
    run(w, ahead(), 1);
    run(w, still, 1);
    expect(w.pose.speed).toBe(0);
    expect(w.settled).toBe(true);
    expect(w.step(1 / 60, still)).toBe(false);
  });

  it('안내 길을 따라가 도착하면 방향을 돌리고 arrived, 손 입력이 들어오면 cancelled', () => {
    const w = new Walker(layout.walk, { x: 0, z: -6, yaw: 0 });
    const events: string[] = [];
    w.follow(
      [
        [0, -6],
        [0, -2],
        [1, -1],
      ],
      Math.PI / 2,
      e => events.push(e),
    );
    run(w, still, 6);
    expect(events).toEqual(['arrived']);
    expect(Math.hypot(w.pose.x - 1, w.pose.z + 1)).toBeLessThan(config().GUIDE_ARRIVE_M + 1e-6);
    expect(w.pose.yaw).toBeCloseTo(Math.PI / 2, 6);
    w.follow([[0, -5]], null, e => events.push(e));
    w.step(1 / 60, ahead());
    expect(events).toEqual(['arrived', 'cancelled']);
    expect(w.guiding).toBe(false);
  });
});

describe('Walker — 새 배치로 바꾸기(P4-9)', () => {
  it('지금 자리에 새 배치에서도 설 수 있으면 그 자리에서 이어 가고, 못 서면 새 배치의 첫 자리로', () => {
    const before = layoutOf([5, 9]);
    const after = layoutOf([5, 9, 6]);
    const s0 = before.walk.spawn;
    const w = new Walker(before.walk, { x: s0.pos[0], z: s0.pos[2], yaw: s0.yaw });
    run(w, ahead(), 1);
    const here = { x: w.pose.x, z: w.pose.z };
    expect(standable(after.walk, [here.x, here.z])).toBe(true);
    expect(w.rebase(after.walk)).toBe('kept');
    expect(w.pose.x).toBeCloseTo(here.x, 6);
    expect(w.pose.z).toBeCloseTo(here.z, 6);
    // 새 배치에서 설 수 없는 곳(전시실 하나뿐인 배치의 둘째 관 자리)
    const small = layoutOf([5]);
    const part2 = after.parts[1]!;
    const inside: [number, number] = [
      (part2.bounds.min[0] + part2.bounds.max[0]) / 2,
      (part2.bounds.min[1] + part2.bounds.max[1]) / 2,
    ];
    const w2 = new Walker(after.walk, { x: inside[0], z: inside[1], yaw: 0 });
    expect(standable(small.walk, inside)).toBe(false);
    expect(w2.rebase(small.walk)).toBe('spawn');
    expect(w2.pose.x).toBeCloseTo(small.walk.spawn.pos[0], 6);
    expect(w2.pose.z).toBeCloseTo(small.walk.spawn.pos[2], 6);
    // 바꾼 뒤에는 새 배치의 벽이 막는다
    run(w2, ahead(), 0.5);
    expect(standable(small.walk, [w2.pose.x, w2.pose.z])).toBe(true);
  });
});

describe('Walker — 벽 부딪힘·점프·뛰기 잠금', () => {
  const layout = layoutOf([5, 9]);
  const backWallStop = -8 + config().WALKABLE_WALL_MARGIN_M;

  it('정면으로 벽에 부딪히면 bump 한 번, 잠깐 멈추고 뒤로 밀려났다가 다시 걸을 수 있다', () => {
    const c = config();
    // 홀 뒷벽(z = −8) 정문 옆(x = 3)으로 똑바로(−Z = cameraYaw π)
    const w = new Walker(layout.walk, { x: 3, z: -6, yaw: Math.PI });
    const into = ahead(Math.PI);
    let hitAt = -1;
    let t = 0;
    for (; t < 4 && hitAt < 0; t += 1 / 60) {
      w.step(1 / 60, into);
      if (w.drainEvents().includes('bump')) hitAt = t;
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(w.pose.z).toBeCloseTo(backWallStop, 1);
    expect(w.pose.bump).toBeGreaterThan(0.9);
    // 멈춘 동안 손 입력을 계속 넣어도 벽 쪽으로 가지 않고 뒤로 밀려난다
    run(w, into, c.CHAR_BUMP_PAUSE_SEC * 0.95);
    expect(w.pose.z - backWallStop).toBeGreaterThan(c.CHAR_BUMP_RECOIL_M * 0.8);
    expect(w.pose.z - backWallStop).toBeLessThan(c.CHAR_BUMP_RECOIL_M * 1.2);
    expect(standable(layout.walk, [w.pose.x, w.pose.z])).toBe(true);
    // 멈춤이 끝나면 다시 손 입력대로(옆으로 걷기)
    run(w, still, 0.1);
    expect(w.pose.bump).toBe(0);
    const x0 = w.pose.x;
    run(w, { forward: 0, strafe: 1, run: false, cameraYaw: Math.PI }, 0.5);
    expect(Math.abs(w.pose.x - x0)).toBeGreaterThan(0.3);
  });

  it('비스듬히 스치거나 천천히 닿으면 부딪힘이 아니다', () => {
    const w = new Walker(layout.walk, { x: 3, z: -6, yaw: Math.PI });
    run(w, { forward: 1, strafe: 0, run: false, cameraYaw: Math.PI * 0.85 }, 3);
    expect(w.drainEvents()).not.toContain('bump');
    const slow = new Walker(layout.walk, { x: 3, z: -7.3, yaw: Math.PI });
    run(slow, { forward: 0.4, strafe: 0, run: false, cameraYaw: Math.PI }, 2);
    expect(slow.drainEvents()).not.toContain('bump');
  });

  it('점프: 떠올랐다가(높이 ≈ v²/2g) 내려앉고, 떠 있는 동안 다시 뛰지 못하며, 앞으로는 계속 간다', () => {
    const c = config();
    const w = new Walker(layout.walk, { x: 0, z: -6, yaw: 0 });
    expect(w.jump()).toBe(true);
    expect(w.jump()).toBe(false);
    let top = 0;
    const z0 = w.pose.z;
    for (let t = 0; t < 1.2; t += 1 / 60) {
      w.step(1 / 60, ahead());
      top = Math.max(top, w.pose.air);
      expect(w.pose.y).toBeCloseTo(floorAt(layout.walk, [w.pose.x, w.pose.z])! + w.pose.air, 6);
    }
    expect(top).toBeCloseTo(c.CHAR_JUMP_SPEED_MPS ** 2 / (2 * c.CHAR_GRAVITY_MPS2), 1);
    expect(w.pose.air).toBe(0);
    expect(w.drainEvents()).toEqual(['jump', 'land']);
    expect(w.pose.z).toBeGreaterThan(z0 + 0.5);
    run(w, still, 1);
    expect(w.settled).toBe(true);
  });

  it('뛰기 잠금 동안은 뛰기 입력이 걷기 빠르기', () => {
    const c = config();
    const w = new Walker(layout.walk, { x: 0, z: -7, yaw: 0 });
    w.lockRun(2);
    run(w, ahead(0, true), 1);
    expect(w.pose.speed).toBeCloseTo(c.CHAR_WALK_MPS, 2);
    expect(w.runLocked).toBe(true);
    run(w, ahead(0, true), 1.2);
    expect(w.runLocked).toBe(false);
    expect(w.pose.move).toBe(2);
  });
});

describe('관람 예절 알림', () => {
  const tick = (m: MannerWatch, sec: number, input: MannerInput): MannerNotice[] => {
    const out: MannerNotice[] = [];
    for (let t = 0; t < sec; t += 1 / 60) {
      const n = m.step(1 / 60, input);
      if (n) out.push(n);
    }
    return out;
  };

  it('실내에서 계속 뛰면 한 번 알리고, 쉬는 시간 안에는 다시 알리지 않는다', () => {
    const c = config();
    const m = new MannerWatch();
    const runIn: MannerInput = { indoor: true, running: true, jumped: false };
    expect(tick(m, c.MANNER_RUN_SEC * 0.9, runIn)).toEqual([]);
    expect(tick(m, c.MANNER_RUN_SEC * 0.2, runIn)).toEqual(['run']);
    expect(tick(m, c.MANNER_COOLDOWN_SEC * 0.8, runIn)).toEqual([]);
    expect(tick(m, c.MANNER_COOLDOWN_SEC * 0.3, runIn)).toEqual(['run']);
  });

  it('광장에서는 뛰어도·뛰어올라도 알리지 않는다', () => {
    const m = new MannerWatch();
    expect(tick(m, 10, { indoor: false, running: true, jumped: false })).toEqual([]);
    for (let i = 0; i < 6; i++)
      expect(m.step(0.2, { indoor: false, running: false, jumped: true })).toBeNull();
  });

  it('실내에서 짧은 시간에 여러 번 뛰어오르면 알린다(띄엄띄엄이면 아님)', () => {
    const c = config();
    const m = new MannerWatch();
    const jump: MannerInput = { indoor: true, running: false, jumped: true };
    const idle: MannerInput = { indoor: true, running: false, jumped: false };
    // 띄엄띄엄: 창보다 긴 간격
    for (let i = 0; i < c.MANNER_JUMP_COUNT + 1; i++) {
      expect(m.step(0.01, jump)).toBeNull();
      tick(m, c.MANNER_JUMP_WINDOW_SEC * 0.6, idle);
    }
    const quick = new MannerWatch();
    const got: (MannerNotice | null)[] = [];
    for (let i = 0; i < c.MANNER_JUMP_COUNT; i++) {
      got.push(quick.step(0.01, jump));
      tick(quick, 0.6, idle);
    }
    expect(got.at(-1)).toBe('jump');
  });
});

describe('안내 이동 길(guide)', () => {
  const layout = layoutOf([5, 9, 3]);
  const map = buildGuideMap(layout);
  const spawn: P2 = [layout.walk.spawn.pos[0], layout.walk.spawn.pos[2]];

  it('광장에서 모든 작품 앞 설 자리까지: 길의 모든 점이 설 수 있는 곳(설비 밖)이고 바닥이 이어진다', () => {
    for (const aspect of [16 / 10, 390 / 844]) {
      for (const stop of layout.stops.filter(s => s.kind === 'artwork')) {
        const spot = standSpot(layout, stop, aspect);
        expect(standable(layout.walk, spot.at), `${stop.id} 설 자리`).toBe(true);
        const path = pathBetween(map, spawn, spot.at);
        expect(path[0]).toEqual(spawn);
        const bad = path.find(p => floorAt(layout.walk, p) === null);
        expect(bad, `${stop.id} 바닥 없는 점`).toBeUndefined();
        // 길의 모든 점에 캐릭터가 설 수 있다(벽·설비 여유 포함 — Codex 검토: 예전 시험은 여유를 빼고 봤음)
        const off = path.find(p => !standable(layout.walk, p));
        expect(off, `${stop.id} 설 수 없는 점`).toBeUndefined();
      }
    }
  });

  it('실제로 걸어 보면 도착한다(광장 → 둘째 관 이젤 작품)', () => {
    const easelFrame = layout.frames.find(
      f => f.mount === 'EASEL' && f.partId.endsWith(':0') && f.partId !== layout.parts[0]!.partId,
    );
    const stop = layout.stops.find(s => s.artworkId === (easelFrame ?? layout.frames.at(-1)!).artworkId)!;
    const spot = standSpot(layout, stop, 16 / 10);
    const w = new Walker(layout.walk, { x: spawn[0], z: spawn[1], yaw: 0 });
    let done = '';
    w.follow(pathBetween(map, spawn, spot.at), spot.yaw, e => (done = e));
    run(w, still, 120);
    expect(done).toBe('arrived');
    expect(Math.hypot(w.pose.x - spot.at[0], w.pose.z - spot.at[1])).toBeLessThan(0.2);
    expect(w.pose.yaw).toBeCloseTo(spot.yaw, 6);
  });

  it('설 자리 방향은 작품 쪽, 카메라는 작품을 정지 지점보다 크게 채운다', () => {
    const stop = layout.stops.find(s => s.kind === 'artwork')!;
    const spot = standSpot(layout, stop, 16 / 10);
    expect(spot.yaw).toBeCloseTo(yawOf(-stop.anchor.normal[0], -stop.anchor.normal[1]), 6);
    expect(spot.camera.achievedFill).toBeGreaterThan(config().STOP_FILL);
  });
});

describe('안내 길 — 막히지 않음(Codex 검토 P1)', () => {
  for (const counts of [[] as number[], [9], [5, 9, 3]]) {
    it(`홀 옆자리에서 회랑으로, 정지 지점마다 차례로 실제로 걸어 도착(${JSON.stringify(counts)})`, () => {
      const layout = layoutOf(counts);
      const map = buildGuideMap(layout);
      // Codex 재현: 홀 오른쪽 앞(5, −2) → 회랑(0, 5)
      const w = new Walker(layout.walk, { x: 5, z: -2, yaw: 0 });
      let done = '';
      const p = pathBetween(map, [5, -2], [0, 5]);
      expect(p.every(q => standable(layout.walk, q))).toBe(true);
      w.follow(p, null, e => (done = e));
      run(w, still, 20);
      expect(done).toBe('arrived');
      // 모든 정지 지점을 차례로
      let here: P2 = [layout.walk.spawn.pos[0], layout.walk.spawn.pos[2]];
      const walker = new Walker(layout.walk, { x: here[0], z: here[1], yaw: 0 });
      for (const stop of layout.stops) {
        const spot = standSpot(layout, stop, 16 / 10);
        const path = pathBetween(map, here, spot.at);
        const off = path.find(q => !standable(layout.walk, q));
        expect(off, `${stop.id} 설 수 없는 점`).toBeUndefined();
        let ev = '';
        walker.follow(path, spot.yaw, e => (ev = e));
        run(walker, still, 90);
        expect(ev, `${stop.id} 도착`).toBe('arrived');
        here = [walker.pose.x, walker.pose.z];
      }
    });
  }

  it('정말 막힌 길이면 잠시 뒤 안내를 끝낸다(영원히 걷지 않음)', () => {
    const layout = layoutOf([5]);
    const w = new Walker(layout.walk, { x: 0, z: -4, yaw: 0 });
    let ev = '';
    // 벽 너머(홀 오른쪽 벽 바깥)로 곧게 — 걸을 수 없는 점
    w.follow(
      [
        [0, -4],
        [20, -4],
      ],
      null,
      e => (ev = e),
    );
    run(w, still, 20);
    expect(ev).toBe('cancelled');
    expect(w.guiding).toBe(false);
  });
});

describe('따라가는 카메라', () => {
  const layout = layoutOf([5]);
  const space = cameraSpace(layout.walk);

  it('넓은 곳에서는 궤도 거리 그대로, 벽 앞에서는 당긴다', () => {
    const open = followPose(space, { x: 0, y: -0.2, z: -24 }, defaultOrbit(0));
    expect(open.distance).toBeCloseTo(config().CAM_DISTANCE_M.default, 1);
    // 홀 앞벽(z = 0, 회랑 열림 옆) 바로 앞에서 벽 쪽(+Z)을 등지고(카메라가 +Z 쪽 뒤에)
    const near = followPose(space, { x: 4, y: 1, z: -0.6 }, defaultOrbit(Math.PI));
    expect(near.distance).toBeLessThan(1);
    expect(space.inside([near.position.x, near.position.z])).not.toBeNull();
  });

  it('현관 기둥을 뚫고 물러서지 않는다(Codex 검토 P2)', () => {
    const e = layout.exterior;
    // Codex 재현 자리: 기둥(1.7, 현관 앞) 뒤 중심에서 기본 궤도
    const pose = followPose(space, { x: 1.7, y: 1, z: e.facadeZ - 2.35 }, defaultOrbit(0));
    const m = config().WALKABLE_WALL_MARGIN_M;
    const clearance = config().ROUTE_CAMERA_CLEARANCE_M;
    const pillars = layout.walk.obstacles.filter(o => o.tall);
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const x = 1.7 + ((pose.position.x - 1.7) * i) / steps;
      const z = e.facadeZ - 2.35 + ((pose.position.z - (e.facadeZ - 2.35)) * i) / steps;
      const inside = pillars.some(
        o =>
          x > o.min[0] + m - clearance &&
          x < o.max[0] - m + clearance &&
          z > o.min[1] + m - clearance &&
          z < o.max[1] - m + clearance,
      );
      expect(inside, `카메라 선분 ${i}/${steps}`).toBe(false);
    }
  });

  it('실내에서 위에서 내려다봐도 천장 아래', () => {
    const c = config();
    const pose = followPose(space, { x: 0, y: 1, z: -4 }, { yaw: 0, pitch: 1.0, distance: 7 });
    expect(pose.position.y).toBeLessThanOrEqual(c.WALL_HEIGHT_M - c.CAM_CEILING_MARGIN_M + 1e-9);
  });
});

describe('그리는 관', () => {
  it('광장은 첫 관만, 관 안이면 그 관 + 반지름 안 관, 단계가 낮을수록 적게', async () => {
    const { visibleParts } = await import('./visibleParts.ts');
    const layout = layoutOf([9, 9, 9, 9]);
    const first = layout.parts[0]!;
    expect([...visibleParts(layout, 'exterior', { x: 0, z: -20 }, 'HIGH')]).toEqual([first.partId]);
    const c = [
      (first.bounds.min[0] + first.bounds.max[0]) / 2,
      (first.bounds.min[1] + first.bounds.max[1]) / 2,
    ] as const;
    const high = visibleParts(layout, first.partId, { x: c[0], z: c[1] }, 'HIGH');
    const low = visibleParts(layout, first.partId, { x: c[0], z: c[1] }, 'LOW');
    expect(high.has(first.partId)).toBe(true);
    expect(low.has(first.partId)).toBe(true);
    expect(high.size).toBeGreaterThanOrEqual(low.size);
    expect(high.size).toBeLessThan(layout.parts.length + 1);
  });
});
