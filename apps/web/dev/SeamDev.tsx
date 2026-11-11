import { config } from '@gallery/core/config';
import { templateLooks } from '@gallery/core/templates';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { type PerspectiveCamera, Vector3 } from 'three';
import coreUrl from '../src/tpl/modern-history/core.glb?url';
import { Stage } from '../src/viewer/scene/Stage.tsx';
import {
  type ModulePlacement,
  TemplateModules,
  useTemplateModules,
} from '../src/viewer/scene/TemplateModules.tsx';

/**
 * `/dev/seam` — 이음새 시험 화면(P1-3, PLAN §13.3). 벽 조각을 한 줄로 이어 붙여 정면에서 본다
 * (4m · 2m · 문 2m · 4m · 4m — 같은 조각끼리, 다른 조각끼리, 문 양옆 경계를 모두 지난다).
 * 잴 자리(경계와 대조용 조각 한가운데)의 화면 열·행 범위를 `window.__seam`에 내놓으면
 * tests/e2e/seam.spec.ts가 화소를 떠서 `tools/assets/pipeline/seamCheck.mjs`로 잰다.
 */

const LOOK = templateLooks['modern-history'];
const ROW = ['mh_wall_4m', 'mh_wall_2m', 'mh_wall_door_2m', 'mh_wall_4m', 'mh_wall_4m'] as const;
const lengthOf = (module: string): number => (module.endsWith('4m') ? 4 : 2);
const TOTAL = ROW.reduce((sum, m) => sum + lengthOf(m), 0);
const EYE_Y = 2.0;
const SIDE_MARGIN_M = 0.6;

/** 재는 높이(m). 회반죽 띠와 판벽 띠. 문 조각에 닿는 경계는 문틀 위 회반죽만(문틀은 바닥~2.8m). */
const BANDS = {
  plaster: [1.4, 3.6],
  plasterAboveDoor: [2.95, 3.65],
  panel: [0.35, 0.95],
} as const;
type BandName = keyof typeof BANDS;

export interface SeamMark {
  readonly kind: 'seam' | 'control';
  readonly x: number;
  readonly band: BandName;
  /** 캔버스 화소(dpr 1) */
  readonly col: number;
  readonly row0: number;
  readonly row1: number;
}

declare global {
  interface Window {
    __seam?: { ready: boolean; marks: SeamMark[] };
  }
}

const marksFor = (): Omit<SeamMark, 'col' | 'row0' | 'row1'>[] => {
  const out: Omit<SeamMark, 'col' | 'row0' | 'row1'>[] = [];
  let x = 0;
  ROW.forEach((module, i) => {
    const len = lengthOf(module);
    const isDoor = module.includes('door');
    if (!isDoor) {
      out.push({ kind: 'control', x: x + len / 2, band: 'plaster' });
      out.push({ kind: 'control', x: x + len / 2, band: 'panel' });
    }
    const next = ROW[i + 1];
    if (next) {
      const touchesDoor = isDoor || next.includes('door');
      out.push({ kind: 'seam', x: x + len, band: touchesDoor ? 'plasterAboveDoor' : 'plaster' });
      if (!touchesDoor) out.push({ kind: 'seam', x: x + len, band: 'panel' });
    }
    x += len;
  });
  return out;
};

const Probe = ({ ready }: { ready: boolean }) => {
  const camera = useThree(s => s.camera) as PerspectiveCamera;
  const size = useThree(s => s.size);
  const invalidate = useThree(s => s.invalidate);

  useEffect(() => {
    // 벽 줄 전체(좌우 여백 포함)가 가로에 꼭 맞는 거리에서 정면으로 — 고개를 들거나 숙이지 않아 세로선이 세로로 남는다.
    const aspect = size.width / size.height;
    const hHalf = Math.atan(Math.tan(((camera.fov / 2) * Math.PI) / 180) * aspect);
    const distance = (TOTAL / 2 + SIDE_MARGIN_M) / Math.tan(hHalf);
    camera.position.set(TOTAL / 2, EYE_Y, distance);
    camera.lookAt(TOTAL / 2, EYE_Y, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (!ready) return;
    const toPx = (x: number, y: number) => {
      const v = new Vector3(x, y, 0).project(camera);
      return { col: ((v.x + 1) / 2) * size.width, row: ((1 - v.y) / 2) * size.height };
    };
    const marks = marksFor().map(m => {
      const [lo, hi] = BANDS[m.band];
      const top = toPx(m.x, hi);
      const bottom = toPx(m.x, lo);
      return { ...m, col: top.col, row0: top.row, row1: bottom.row };
    });
    invalidate();
    // 그 다음 화면이 실제로 그려진 뒤에 알린다(정지 상태 다시 그리기 없음).
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        window.__seam = { ready: true, marks };
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, camera, size, invalidate]);

  return null;
};

const Wall = () => {
  const modules = useTemplateModules(coreUrl, LOOK);
  const placements = useMemo<ModulePlacement[]>(() => {
    const out: ModulePlacement[] = [];
    let x = 0;
    for (const module of ROW) {
      out.push({ module, x, y: 0, z: 0, rotY: 0 });
      x += lengthOf(module);
    }
    for (let fx = 0; fx < TOTAL; fx += 2)
      for (let fz = 0; fz < 8; fz += 2) out.push({ module: 'mh_floor_2x2', x: fx, y: 0, z: fz, rotY: 0 });
    return out;
  }, []);
  return (
    <>
      {modules && <TemplateModules modules={modules} placements={placements} />}
      <Probe ready={modules !== null} />
    </>
  );
};

export const SeamDev = () => (
  <div style={{ position: 'fixed', inset: 0 }}>
    <Canvas
      frameloop="demand"
      dpr={1}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      camera={{ fov: config().VFOV_DEG, near: 0.05, far: 80 }}
    >
      <Stage look={LOOK} />
      <Wall />
    </Canvas>
  </div>
);
