import type { TourPlan } from '@gallery/core/tour';
import type { Layout } from '@gallery/core/types';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { applyAmbience } from '../scene/ambience.ts';
import { sceneDim } from '../scene/materials.ts';
import { buildGuideMap } from '../walk/guide.ts';
import { useWalk } from '../walk/walkStore.ts';
import { buildTourCamera } from './tourCamera.ts';

/**
 * 자동 투어 조종기(P5-9, G-16): 투어 시각 t → 카메라 자세·장면 밝기(`buildTourCamera`, 순수 함수).
 * `VisitorScene controller`로 걷기 대신 쓴다. 재생 중에는 프레임마다 t를 늘리고, 멈추면 다시 그리지 않는다.
 * 지금 구역을 알려 그 둘레 관만 붙이고(§6.6), 자리를 상주 관리에 알린다(1m 칸이 바뀔 때만).
 */
export interface TourClock {
  /** 지금 시각(s). 조종기가 재생 중에 늘린다. 바깥(진행 막대)이 바꿔도 된다 */
  t: number;
  playing: boolean;
  /** 재생 시작·탐색·직전 프레임의 단조 시각(ms). 정지한 시간은 재생 시간에 더하지 않는다. */
  updatedAt: number | null;
}

export const TourDriver = ({
  layout,
  plan,
  clock,
  onRegion,
  onTick,
}: {
  layout: Layout;
  plan: TourPlan;
  clock: TourClock;
  onRegion: (region: string) => void;
  /** 그린 프레임마다(소리 맞추기·진행 막대) */
  onTick: (t: number, playing: boolean) => void;
}) => {
  const camera = useThree(s => s.camera) as PerspectiveCamera;
  const size = useThree(s => s.size);
  const invalidate = useThree(s => s.invalidate);
  const aspect = size.width / Math.max(1, size.height);
  const cam = useMemo(() => buildTourCamera(layout, plan, aspect), [layout, plan, aspect]);
  const map = useMemo(() => buildGuideMap(layout), [layout]);
  const st = useRef({ region: '', cellX: Number.NaN, cellZ: Number.NaN, lastT: -1 }).current;

  // 바깥이 t를 바꾸거나(되감기) 재생을 켜면 다시 그린다
  useEffect(() => {
    invalidate();
  });
  useEffect(
    () => () => {
      sceneDim.value = 1;
    },
    [],
  );

  useEffect(() => {
    const reset = () => {
      clock.updatedAt = null;
    };
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, [clock]);

  useFrame(() => {
    const now = performance.now();
    const dt = clock.updatedAt === null ? 0 : Math.max(0, (now - clock.updatedAt) / 1000);
    clock.updatedAt = now;
    if (clock.playing) clock.t = Math.min(cam.totalSec, clock.t + dt);
    if (clock.t >= cam.totalSec) clock.playing = false;
    const f = cam.at(clock.t);
    camera.position.set(f.pose.position.x, f.pose.position.y, f.pose.position.z);
    camera.lookAt(f.pose.target.x, f.pose.target.y, f.pose.target.z);
    if (Math.abs(camera.fov - f.pose.fov) > 1e-4) {
      camera.fov = f.pose.fov;
      camera.updateProjectionMatrix();
    }
    sceneDim.value = f.dim;
    const region = map.regionOf([f.pose.position.x, f.pose.position.z]);
    if (region !== st.region) {
      st.region = region;
      onRegion(region);
      applyAmbience(region === 'exterior' ? 0 : 1);
    }
    const cx = Math.round(f.pose.position.x);
    const cz = Math.round(f.pose.position.z);
    if (cx !== st.cellX || cz !== st.cellZ) {
      st.cellX = cx;
      st.cellZ = cz;
      useWalk
        .getState()
        .set({ me: { x: f.pose.position.x, y: f.pose.position.y, z: f.pose.position.z, yaw: 0 } });
    }
    onTick(clock.t, clock.playing);
    if (clock.playing) invalidate();
  });
  return null;
};
