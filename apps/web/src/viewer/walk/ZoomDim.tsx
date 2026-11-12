import { config } from '@gallery/core/config';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type DimHolder, sceneDim } from '../scene/materials.ts';
import { useWalk } from './walkStore.ts';

/**
 * 작품 크게 보기의 밝기(PRD 8.2, P6-2): 크게 보는 동안 주변은 `ZOOM_DIM`(70%)까지 `T_ZOOM`에 걸쳐 낮추고,
 * 그 작품(액자·빛 웅덩이)은 1에 둔다. 닫으면 `T_UNZOOM`에 걸쳐 되돌린다. 동작 줄이기면 바로 바꾼다.
 * 움직이는 동안만 다시 그린다(정지 상태 0, AGENTS §4). 투어처럼 카메라를 바깥이 몰 때는 붙이지 않는다.
 */
export const ZoomDim = ({
  holders,
  reducedMotion,
}: {
  holders: Readonly<Record<string, DimHolder>>;
  reducedMotion: boolean;
}) => {
  const invalidate = useThree(st => st.invalidate);
  const zoomId = useWalk(st => (st.mode === 'zoom' ? st.zoomId : null));
  const level = useRef(1);
  const target = useRef<string | null>(null);
  if (zoomId !== null) target.current = zoomId;
  useEffect(() => {
    invalidate();
  }, [zoomId, invalidate]);
  useEffect(
    () => () => {
      sceneDim.value = 1;
      for (const h of Object.values(holders)) h.value = 1;
    },
    [holders],
  );
  useFrame((_, dtIn) => {
    const c = config();
    const want = zoomId !== null ? c.ZOOM_DIM : 1;
    const cur = level.current;
    if (cur === want) return;
    const span = 1 - c.ZOOM_DIM;
    const sec = zoomId !== null ? c.T_ZOOM : c.T_UNZOOM;
    const step = reducedMotion ? span : (Math.min(dtIn, 0.1) / sec) * span;
    const next = want < cur ? Math.max(want, cur - step) : Math.min(want, cur + step);
    level.current = next;
    sceneDim.value = next;
    // 크게 보는(보던) 작품만 밝게 두고 나머지는 장면 값을 따른다
    for (const [id, h] of Object.entries(holders)) h.value = id === target.current ? 1 : next;
    if (next === 1) target.current = null;
    invalidate();
  });
  return null;
};
