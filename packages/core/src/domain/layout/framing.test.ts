import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { config } from '../../config.ts';
import { frameCamera, frameCameraWithSide, stopFraming, zoomFraming, type FrameAnchor } from './framing.ts';

const anchor = (w: number, h: number, maxDistance = 8): FrameAnchor => ({
  center: { x: 0, y: 1.5, z: -5 },
  normal: { x: 0, y: 0, z: 1 },
  outer: { w, h },
  maxDistance,
});

const tanHalf = (fovDeg: number) => Math.tan((fovDeg * Math.PI) / 360);

describe('frameCamera', () => {
  it('넓은 화면의 정지 지점: 기본 화각에서 세로 55%를 채운다', () => {
    const pose = frameCamera(anchor(1.6, 1.2), { aspect: 16 / 9 }, stopFraming());
    expect(pose.fov).toBe(config().VFOV_DEG);
    expect(pose.achievedFill).toBeCloseTo(config().STOP_FILL, 5);
    expect(pose.position.y).toBe(config().CAMERA_HEIGHT_M);
    expect(pose.position.z).toBeGreaterThan(-5); // 벽 앞(법선 방향)
    expect(pose.target).toEqual({ x: 0, y: 1.5, z: -5 });
  });

  it('세로 화면은 화각을 넓히지 않고 먼저 물러선다', () => {
    const wide = frameCamera(anchor(1.6, 1.2), { aspect: 16 / 9 }, stopFraming());
    const tall = frameCamera(anchor(1.6, 1.2), { aspect: 0.46 }, stopFraming());
    expect(tall.fov).toBe(config().VFOV_DEG);
    expect(tall.position.z).toBeGreaterThan(wide.position.z);
  });

  it('물러설 공간이 모자라면 화각을 넓히되 상한을 넘지 않고, 거리는 공간 안에 둔다', () => {
    const pose = frameCamera(anchor(1.6, 1.2, 3), { aspect: 0.46 }, stopFraming());
    expect(pose.fov).toBeGreaterThan(config().VFOV_DEG);
    expect(pose.fov).toBeLessThanOrEqual(config().VFOV_MAX_DEG);
    expect(pose.position.z - -5).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('보장 범위(배치 엔진이 만드는 방) 안에서는 액자가 화면 밖으로 나가지 않는다', () => {
    const c = config();
    const minSpace = c.ROOM_MIN_D_M - c.CAMERA_WALL_CLEARANCE_M;
    fc.assert(
      fc.property(
        // 배치 엔진의 가장 큰 바깥 폭: 대표작 파노라마 3.12 + 매트 2×0.196 + 테 2×0.07 = 3.652m
        fc.double({ min: 0.3, max: 3.66, noNaN: true }),
        fc.double({ min: 0.3, max: 2.6, noNaN: true }),
        fc.double({ min: 0.4, max: 2.4, noNaN: true }),
        fc.double({ min: minSpace, max: 12, noNaN: true }),
        fc.boolean(),
        (w, h, aspect, maxD, zoom) => {
          const pose = frameCamera(anchor(w, h, maxD), { aspect }, zoom ? zoomFraming() : stopFraming());
          const d = pose.position.z - -5;
          const visibleH = 2 * d * tanHalf(pose.fov);
          expect(d).toBeLessThanOrEqual(maxD + 1e-9);
          expect(h).toBeLessThanOrEqual(visibleH + 1e-9);
          expect(w).toBeLessThanOrEqual(visibleH * aspect + 1e-9);
          expect(pose.fov).toBeLessThanOrEqual(config().VFOV_HARD_MAX_DEG);
        },
      ),
      { seed: 20261111, numRuns: 400 },
    );
  });

  it('줌에서 캡션이 아래를 가리면 정면을 유지한 채 액자를 남은 영역 가운데로 올린다', () => {
    const plain = frameCamera(anchor(1.2, 1.2), { aspect: 16 / 9 }, zoomFraming());
    const withCaption = frameCamera(anchor(1.2, 1.2), { aspect: 16 / 9, insetBottom: 0.25 }, zoomFraming());
    expect(plain.position.y).toBeCloseTo(plain.target.y, 9); // 정면
    expect(withCaption.position.y).toBeCloseTo(withCaption.target.y, 9);
    expect(withCaption.target.y).toBeLessThan(1.5); // 목표를 내리면 화면에서 액자가 올라간다
    expect(withCaption.achievedFill).toBeCloseTo(config().ZOOM_FILL, 5);
  });
});

describe('frameCameraWithSide (명판까지 화면에)', () => {
  // 1.2m 액자 왼쪽(−X)에 명판: 액자 끝 + 띄움 0.15 + 그리기 띄움 0.08 + 판 반 폭 0.15
  const side = { along: { x: -1, y: 0, z: 0 }, reach: 0.6 + 0.15 + 0.08 + 0.3 };
  const halfWidth = (pose: ReturnType<typeof frameCamera>, aspect: number) =>
    Math.hypot(pose.position.x - pose.target.x, pose.position.z - pose.target.z) * tanHalf(pose.fov) * aspect;

  it('휴대폰 세로: 명판 먼 끝이 보이는 가로 안에 들어온다(가운데가 명판 쪽으로)', () => {
    const aspect = 390 / 844;
    const only = frameCamera(anchor(1.2, 0.9), { aspect }, stopFraming());
    expect(side.reach).toBeGreaterThan(halfWidth(only, aspect)); // 액자만 맞추면 잘림(고치기 전)
    const pose = frameCameraWithSide(anchor(1.2, 0.9), { aspect }, stopFraming(), side);
    const edge = 0 - side.reach; // 명판 먼 끝의 x
    expect(Math.abs(edge - pose.target.x)).toBeLessThanOrEqual(halfWidth(pose, aspect));
    // 액자 반대쪽 끝도 화면 안
    expect(Math.abs(0.6 - pose.target.x)).toBeLessThanOrEqual(halfWidth(pose, aspect));
    expect(pose.target.x).toBeLessThan(0);
  });

  it('넓은 화면은 명판이 이미 보이므로 액자만 맞춘 것과 같다', () => {
    const plain = frameCamera(anchor(1.2, 0.9), { aspect: 16 / 9 }, stopFraming());
    expect(frameCameraWithSide(anchor(1.2, 0.9), { aspect: 16 / 9 }, stopFraming(), side)).toEqual(plain);
    expect(frameCameraWithSide(anchor(1.2, 0.9), { aspect: 0.46 }, stopFraming(), null)).toEqual(
      frameCamera(anchor(1.2, 0.9), { aspect: 0.46 }, stopFraming()),
    );
  });
});
