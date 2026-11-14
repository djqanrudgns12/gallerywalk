import { describe, expect, it } from 'vitest';
import { decodePoses, POSE_FIELDS, pushPose, roundPose, wrapYaw } from './poseCodec.ts';

describe('위치 v2 부호(HS-02)', () => {
  it('방향은 -π~π로 감고, 반올림은 1cm·0.001rad', () => {
    expect(wrapYaw(7)).toBeCloseTo(7 - 2 * Math.PI, 9);
    expect(wrapYaw(-7)).toBeCloseTo(-7 + 2 * Math.PI, 9);
    expect(wrapYaw(0.5)).toBeCloseTo(0.5, 12);
    expect(roundPose({ x: 1.23456, y: -0.005, z: 499.999, yaw: 3.5, move: 2 })).toEqual({
      x: 1.23,
      y: -0,
      z: 500,
      yaw: Math.round(wrapYaw(3.5) * 1000) / 1000,
      move: 2,
    });
  });

  it('만들고 풀면 반올림한 자리로 돌아온다(여러 사람)', () => {
    const flat: number[] = [];
    pushPose(flat, 1, { x: -499.994, y: 19.99, z: 0.004, yaw: -3.1415, move: 3 });
    pushPose(flat, 65_535, { x: 12.345, y: 0, z: -6.789, yaw: 1, move: 0 });
    expect(flat).toHaveLength(POSE_FIELDS * 2);
    expect(decodePoses(flat)).toEqual([
      { n: 1, pose: { x: -499.99, y: 19.99, z: 0, yaw: -3.142, move: 3 } },
      { n: 65_535, pose: { x: 12.35, y: 0, z: -6.79, yaw: 1, move: 0 } },
    ]);
  });

  it('모양·범위가 틀리면 null', () => {
    expect(decodePoses('x')).toBeNull();
    expect(decodePoses([1, 2, 3])).toBeNull();
    expect(decodePoses([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(decodePoses([1, 50_001, 0, 0, 0, 0])).toBeNull();
    expect(decodePoses([1, 0, 2_001, 0, 0, 0])).toBeNull();
    expect(decodePoses([1, 0, 0, 0, 3_143, 0])).toBeNull();
    expect(decodePoses([1, 0, 0, 0, 0, 4])).toBeNull();
    expect(decodePoses([1, 0.5, 0, 0, 0, 0])).toBeNull();
    expect(decodePoses([])).toEqual([]);
  });
});
