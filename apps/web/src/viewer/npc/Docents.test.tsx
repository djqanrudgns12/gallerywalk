import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { useWalk } from '../walk/walkStore.ts';
import { Docents } from './Docents.tsx';
import { useDocentSpeech } from './docentStore.ts';

// WebGL 없이 연결만 본다: R3F는 프레임 함수를 잡아 두고 직접 부르며, glb는 못 읽은 것으로(임시 한 덩어리 모형)
const scene = vi.hoisted(() => ({
  frame: null as ((state: unknown, delta: number) => void) | null,
  invalidate: (): void => {},
  invalidations: 0,
  gl: {},
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (select: (s: unknown) => unknown) => select(scene),
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    scene.frame = cb;
  },
}));
vi.mock('../scene/Character.tsx', () => ({
  CHARACTER_BASE: '/assets/g/chr-1',
  loadCharacterGlb: () => Promise.resolve(null),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scene.invalidations = 0;
  scene.invalidate = () => {
    scene.invalidations++;
  };
  useWalk.setState(useWalk.getInitialState());
  useDocentSpeech.setState({ talk: null, bubble: null });
  // react-dom이 3D 요소(<primitive>)를 모르는 태그라고 알리는 것만 조용히
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  errors.mockRestore();
  resetConfig();
});

it('도슨트 자리를 걷기 저장소에 채우고, 말걸기 요청 → 대사 카드·머리 위 말풍선 → 닫기 → 떼면 비운다', async () => {
  overrideConfig({ ALGO_VERSION: 4 });
  const layout = testExhibitionView([4, 4, 4]).layout;
  const hall = layout.npcSpots?.find(s => s.id === 'docent-hall');
  expect(hall).toBeDefined();
  if (!hall) return;
  // 홀 도슨트 앞 1.5m에 서서 도슨트를 본다
  const fx = Math.sin(hall.yaw);
  const fz = Math.cos(hall.yaw);
  const me = { x: hall.pos[0] + fx * 1.5, y: 0, z: hall.pos[2] + fz * 1.5, yaw: Math.atan2(-fx, -fz) };
  useWalk.getState().set({ me });
  const camera = new PerspectiveCamera(config().VFOV_DEG, 4 / 3, 0.05, 120);
  camera.position.set(me.x + fx * 2, 1.6, me.z + fz * 2);
  camera.lookAt(hall.pos[0], 1.4, hall.pos[2]);
  const state = { camera, size: { width: 800, height: 600 } };

  await act(async () => {
    root.render(<Docents layout={layout} region="spine" visibleParts={new Set<string>()} />);
    await Promise.resolve();
  });
  expect(useWalk.getState().npcs.map(n => n.id)).toEqual(['docent-plaza', 'docent-hall', 'docent-room']);

  act(() => scene.frame?.(state, 0.016));
  // 그리지 않는 광장 도슨트는 말걸기를 받지 않는다
  act(() => useWalk.getState().set({ talkRequest: { npcId: 'docent-plaza', at: 1 } }));
  expect(useDocentSpeech.getState().talk).toBeNull();

  act(() => useWalk.getState().set({ talkRequest: { npcId: 'docent-hall', at: 2 } }));
  const talk = useDocentSpeech.getState().talk;
  expect(talk?.npcId).toBe('docent-hall');
  expect(copy.museumDocent.zones.hall).toContain(talk?.line);
  expect(talk?.text).toBe(copy.museumDocent.lines[(talk?.line ?? 0) - 1]);

  const before = scene.invalidations;
  act(() => scene.frame?.(state, 0.016));
  const bubble = useDocentSpeech.getState().bubble;
  expect(bubble?.kind).toBe('talk');
  expect(bubble?.onScreen).toBe(true);
  expect(bubble?.x).toBeGreaterThan(0);
  expect(bubble?.x).toBeLessThan(800);
  // 대사 중에는 스스로 다음 프레임을 부른다
  expect(scene.invalidations).toBeGreaterThan(before);

  act(() => useDocentSpeech.getState().closeTalk());
  act(() => scene.frame?.(state, 0.016));
  expect(useDocentSpeech.getState().talk).toBeNull();
  expect(useDocentSpeech.getState().bubble).toBeNull();

  act(() => root.unmount());
  expect(useWalk.getState().npcs).toEqual([]);
  root = createRoot(document.createElement('div'));
});

it('스키마 2 배치는 도슨트도 저장소 쓰기도 없다', async () => {
  const layout = testExhibitionView([4]).layout;
  const npcs = useWalk.getState().npcs;
  await act(async () => {
    root.render(<Docents layout={layout} region="exterior" visibleParts={new Set<string>()} />);
    await Promise.resolve();
  });
  expect(useWalk.getState().npcs).toBe(npcs);
  act(() => useWalk.getState().set({ talkRequest: { npcId: 'docent-hall', at: 1 } }));
  expect(useDocentSpeech.getState().talk).toBeNull();
});
