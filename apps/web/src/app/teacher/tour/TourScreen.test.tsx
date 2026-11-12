import { copy } from '@gallery/core/copy';
import type { TeacherExhibitionView } from '@gallery/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teacherArtwork, teacherExhibition, teacherRoom } from '../../../dev/teacherFixtures.ts';
import { fakeTeacher, mountTeacher, teacherServices } from '../../../dev/teacherShellFixtures.tsx';
import { testExhibitionView } from '../../../dev/testView.ts';
import { flushUntil } from '../../student/testDom.tsx';
import { TourScreen } from './TourScreen.tsx';

// 3D·소리는 jsdom에서 그리지 않는다 — 시작 덮개만 본다
vi.mock('@react-three/fiber', () => ({ Canvas: () => null }));
vi.mock('../../../viewer/VisitorScene.tsx', () => ({ VisitorScene: () => null }));
vi.mock('../../../viewer/tour/TourDriver.tsx', () => ({ TourDriver: () => null }));
vi.mock('../../../audio/tourSoundtrack.ts', () => ({ TourSoundtrack: class {} }));
vi.mock('../../visit/walkUi.tsx', () => ({ dprCap: () => 1 }));

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('자동 투어 시작 덮개', () => {
  it('수업 전 미리 불러오기 안내 한 줄(PLAN §6.13, P5-10)', async () => {
    const v = testExhibitionView([3]);
    const tv: TeacherExhibitionView = {
      exhibition: teacherExhibition(),
      rooms: [teacherRoom(0)],
      artworks: [teacherArtwork(0, 0), teacherArtwork(0, 1), teacherArtwork(0, 2)],
      layout: v.layout,
      versions: v.versions,
    };
    const t = teacherServices(fakeTeacher({ exhibition: vi.fn(async () => tv) }));
    const m = mountTeacher(<TourScreen />, t.services, `/t/e/${tv.exhibition.id}/tour`, '/t/e/:id/tour');
    mounted = m;
    await flushUntil(() => m.q('[data-testid="tour-start"]') !== null);
    expect(m.q('[data-testid="tour-preload-hint"]')?.textContent).toBe(copy.teacher.preload.tourHint);
  });
});
