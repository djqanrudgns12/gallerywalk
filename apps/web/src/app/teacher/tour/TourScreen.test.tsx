import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { planTour } from '@gallery/core/tour';
import type { TeacherExhibitionView } from '@gallery/core/types';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teacherArtwork, teacherExhibition, teacherRoom } from '../../../dev/teacherFixtures.ts';
import { fakeTeacher, mountTeacher, teacherServices } from '../../../dev/teacherShellFixtures.tsx';
import { testExhibitionView } from '../../../dev/testView.ts';
import { click, key } from '../../../dev/teacherDom.tsx';
import { tourInputOf } from '../../../viewer/tour/tourCamera.ts';
import { flushUntil } from '../../student/testDom.tsx';
import { visitModelOf } from '../../visit/visitModel.ts';
import { previewViewOf } from './previewView.ts';
import { TourScreen } from './TourScreen.tsx';
import { tourStops } from './tourStops.ts';

// 3D·소리는 jsdom에서 그리지 않는다 — 시작 덮개와 장면에 넘기는 값만 본다.
// 가짜 Canvas는 만들어졌다고 한 번 알리고(그래야 품질 단계가 정해져 장면이 붙는다) 자식을 그대로 그린다.
const scene = vi.hoisted(() => ({ props: [] as { character?: unknown }[] }));
vi.mock('@react-three/fiber', async () => {
  const { useEffect } = await import('react');
  type Created = (s: { gl: unknown }) => void;
  const gl = {
    getContext: () => ({ getExtension: () => null, getParameter: () => '' }),
    capabilities: { maxTextureSize: 4096 },
  };
  return {
    Canvas: ({ children, onCreated }: { children?: unknown; onCreated?: Created }) => {
      useEffect(() => onCreated?.({ gl }), []);
      return children;
    },
  };
});
vi.mock('../../../viewer/VisitorScene.tsx', () => ({
  VisitorScene: (props: { character?: unknown }) => {
    scene.props.push(props);
    return null;
  },
}));
vi.mock('../../../viewer/tour/TourDriver.tsx', () => ({ TourDriver: () => null }));
vi.mock('../../../audio/tourSoundtrack.ts', () => ({ TourSoundtrack: class {} }));
vi.mock('../../visit/walkUi.tsx', () => ({ dprCap: () => 1 }));

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  scene.props.length = 0;
});

const tourView = (): TeacherExhibitionView => {
  const v = testExhibitionView([3]);
  return {
    exhibition: teacherExhibition(),
    rooms: [teacherRoom(0)],
    artworks: [teacherArtwork(0, 0), teacherArtwork(0, 1), teacherArtwork(0, 2)],
    layout: v.layout,
    versions: v.versions,
  };
};

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

  it('장면의 선생님 캐릭터는 이 기기에 기억한 것(V-04, PRD 15.8)', async () => {
    const tv = tourView();
    const t = teacherServices(fakeTeacher({ exhibition: vi.fn(async () => tv) }));
    t.device.setTeacherCharacter('teacher-f');
    const m = mountTeacher(<TourScreen />, t.services, `/t/e/${tv.exhibition.id}/tour`, '/t/e/:id/tour');
    mounted = m;
    await flushUntil(() => scene.props.length > 0);
    expect(scene.props.at(-1)?.character).toBe('teacher-f');
  });
});

describe('자동 투어 조작(V-16, PRD G-16·15.4-7)', () => {
  const twoRooms = (): TeacherExhibitionView => {
    const v = testExhibitionView([2, 2]);
    return {
      exhibition: teacherExhibition(),
      rooms: [teacherRoom(0), teacherRoom(1)],
      artworks: [teacherArtwork(0, 0), teacherArtwork(0, 1), teacherArtwork(1, 0), teacherArtwork(1, 1)],
      layout: v.layout,
      versions: v.versions,
    };
  };

  /** 화면이 쓰는 것과 같은 시간표에서 얻은 건너뛰기 지점(배경음악 없음) */
  const stopsOf = (tv: TeacherExhibitionView): number[] => {
    const view = previewViewOf(tv);
    if (!view) throw new Error('no view');
    return tourStops(
      planTour(tourInputOf(visitModelOf(view).layout, () => null, tv.exhibition.settings.tour)),
    );
  };

  const startTour = async (tv: TeacherExhibitionView) => {
    const t = teacherServices(fakeTeacher({ exhibition: vi.fn(async () => tv) }));
    const m = mountTeacher(<TourScreen />, t.services, `/t/e/${tv.exhibition.id}/tour`, '/t/e/:id/tour');
    mounted = m;
    await flushUntil(() => m.q('[data-testid="tour-start"]') !== null);
    click(m.q('[data-testid="tour-start"]'));
    await flushUntil(() => m.q('[data-testid="tour-bar"]') !== null);
    return m;
  };
  const progress = (): number => Number(mounted?.q<HTMLInputElement>('#tour-progress')?.value ?? NaN);
  const screen = () => mounted?.q('[data-testid="tour-screen"]') ?? null;
  const press = (code: string, on: Element = document.body): void => key(on, code, { code });

  it('→ 는 다음 전시실 시작, ← 는 이전 전시실 시작으로(10초 감기가 아님)', async () => {
    const tv = twoRooms();
    const stops = stopsOf(tv);
    expect(stops.length).toBeGreaterThanOrEqual(3);
    await startTour(tv);
    expect(progress()).toBe(0);
    press('ArrowRight');
    expect(progress()).toBe(Math.round(stops[1] ?? NaN));
    press('ArrowRight');
    expect(progress()).toBe(Math.round(stops[2] ?? NaN));
    press('ArrowLeft');
    expect(progress()).toBe(Math.round(stops[1] ?? NaN));
    press('ArrowLeft');
    expect(progress()).toBe(0);
  });

  it('진행 막대에 초점이 있을 때만 좌우 키가 10초씩 감는다', async () => {
    await startTour(twoRooms());
    const range = mounted?.q<HTMLInputElement>('#tour-progress') ?? null;
    act(() => range?.focus());
    press('ArrowRight', range ?? document.body);
    press('ArrowRight', range ?? document.body);
    expect(progress()).toBe(20);
    press('ArrowLeft', range ?? document.body);
    expect(progress()).toBe(10);
  });

  it('Space는 멈춤/재생, Esc는 전시 관리로', async () => {
    const tv = twoRooms();
    await startTour(tv);
    expect(screen()?.getAttribute('data-playing')).toBe('1');
    press('Space');
    expect(screen()?.getAttribute('data-playing')).toBe('0');
    press('Space');
    expect(screen()?.getAttribute('data-playing')).toBe('1');
    press('Escape');
    expect(mounted?.location().path).toBe(`/t/e/${tv.exhibition.id}`);
  });

  it('장면을 누르면 멈춤/재생', async () => {
    await startTour(twoRooms());
    const scene = mounted?.q('[data-testid="tour-scene"]') ?? null;
    click(scene);
    expect(screen()?.getAttribute('data-playing')).toBe('0');
    click(scene);
    expect(screen()?.getAttribute('data-playing')).toBe('1');
  });

  it('조작판에 마우스나 초점이 있으면 느린 클릭 도중 조작판을 숨기지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await startTour(twoRooms());
      const bar = mounted!.q('[data-testid="tour-bar"]')!;
      act(() => bar.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
      act(() => vi.advanceTimersByTime(config().IDLE_DIM_SEC * 2000));
      expect(screen()?.getAttribute('data-idle')).toBe('0');
      click(mounted!.q('[data-testid="tour-toggle"]'));
      expect(screen()?.getAttribute('data-playing')).toBe('0');
      press('Space');
      act(() => mounted!.q<HTMLButtonElement>('[data-testid="tour-toggle"]')!.focus());
      act(() => bar.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })));
      act(() => vi.advanceTimersByTime(config().IDLE_DIM_SEC * 2000));
      expect(screen()?.getAttribute('data-idle')).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('재생 중 입력이 없으면 조작판·커서를 숨기고, 움직이거나 누르면 다시 보인다. 멈춘 동안은 숨기지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await startTour(twoRooms());
      const idleMs = config().IDLE_DIM_SEC * 1000;
      expect(screen()?.getAttribute('data-idle')).toBe('0');
      act(() => vi.advanceTimersByTime(idleMs + 50));
      expect(screen()?.getAttribute('data-idle')).toBe('1');

      act(() => screen()?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })));
      expect(screen()?.getAttribute('data-idle')).toBe('0');
      act(() => vi.advanceTimersByTime(idleMs + 50));
      expect(screen()?.getAttribute('data-idle')).toBe('1');

      act(() => screen()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
      expect(screen()?.getAttribute('data-idle')).toBe('0');

      press('Space');
      expect(screen()?.getAttribute('data-playing')).toBe('0');
      act(() => vi.advanceTimersByTime(idleMs * 3));
      expect(screen()?.getAttribute('data-idle')).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });
});
