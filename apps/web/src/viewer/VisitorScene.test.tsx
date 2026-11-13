import { templateMoods } from '@gallery/core/templates';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { visitModelOf } from '../app/visit/visitModel.ts';
import { testExhibitionView } from '../dev/testView.ts';
import { VisitorScene } from './VisitorScene.tsx';
import { useWalk } from './walk/walkStore.ts';

const scene = vi.hoisted(() => ({ renders: 0, invalidate: () => {}, gl: {} }));
vi.mock('@react-three/fiber', () => ({ useThree: (select: (s: unknown) => unknown) => select(scene) }));
vi.mock('./scene/TemplateModules.tsx', () => ({
  useTemplateModules: () => null,
  TemplateModules: () => null,
}));
vi.mock('./scene/Stage.tsx', () => ({ Stage: () => null }));
vi.mock('./npc/Docents.tsx', () => ({ Docents: () => null }));
vi.mock('./scene/Sky.tsx', () => ({ Sky: () => null }));
vi.mock('./scene/ExteriorContact.tsx', () => ({ ExteriorContact: () => null }));
vi.mock('./scene/FixtureModels.tsx', () => ({ FixtureModels: () => null }));
vi.mock('./scene/ArtworkLabels.tsx', () => ({ ArtworkLabels: () => null }));
vi.mock('./scene/FacadeSign.tsx', () => ({ FacadeSign: () => null }));
vi.mock('./scene/ArtworkFrame.tsx', () => ({ ArtworkFrame: () => null }));
vi.mock('./scene/MicroMotion.tsx', () => ({ MicroMotion: () => null }));
vi.mock('./scene/Vignette.tsx', () => ({ Vignette: () => null }));
vi.mock('./signs/SignTexts.tsx', () => ({ SignTexts: () => null }));
vi.mock('./walk/ZoomDim.tsx', () => ({ ZoomDim: () => null }));
vi.mock('./walk/WalkView.tsx', () => ({
  WalkView: () => {
    scene.renders++;
    return null;
  },
}));
vi.mock('./textures/useCardTextures.ts', () => ({ useCardTextures: () => new Map() }));
vi.mock('./textures/useResidentTextures.ts', () => ({
  useResidentTextures: () => ({ textureOf: () => null }),
}));

it('같은 1m 칸에서 정지 위치·방향만 갱신하면 장면을 재렌더하지 않고 칸을 넘을 때 갱신한다', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWalk.setState(useWalk.getInitialState());
  scene.renders = 0;
  const model = visitModelOf(testExhibitionView([2]));
  const root = createRoot(document.createElement('div'));
  try {
    act(() =>
      root.render(
        <VisitorScene
          layout={model.layout}
          artworks={model.artworks}
          holders={{}}
          title="합성 전시"
          look={templateMoods['modern-history'].a}
          modulesUrl=""
          character="student-m"
          tier="HIGH"
          placeOf={model.placeOf}
        />,
      ),
    );
    const before = scene.renders;
    act(() => useWalk.getState().set({ me: { x: 0.1, y: 1, z: 0.2, yaw: 1 } }));
    expect(scene.renders).toBe(before);
    act(() => useWalk.getState().set({ me: { x: 0.6, y: 1, z: 0.2, yaw: 1 } }));
    expect(scene.renders).toBe(before + 1);
  } finally {
    act(() => root.unmount());
    useWalk.setState(useWalk.getInitialState());
  }
});
