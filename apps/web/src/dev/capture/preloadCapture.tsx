import type { TeacherExhibitionView } from '@gallery/core/types';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/tokens.css';
import '../../ui/themes/modern-history.css';
import '../../app/App.module.css';
import { ServicesContext, type AppServices } from '../../app/services.ts';
import { PreloadSheet } from '../../app/teacher/manage/PreloadSheet.tsx';
import type { MediaCache, PreloadProgress } from '../../ports/mediaCache.ts';
import { teacherArtwork, teacherExhibition, teacherRoom } from '../teacherFixtures.ts';
import { fakeTeacher, teacherServices } from '../teacherShellFixtures.tsx';
import { testExhibitionView } from '../testView.ts';

/**
 * 캡처 전용(P5-10): 개발 서버에는 서비스 워커가 없어 실제 시트는 늘 "쓸 수 없어요"라서, 가짜 기기 캐시로 상태를 고정해 그린다.
 * `/src/dev/capture/preload.html?state=loading|ready|nospace|unavailable`. 운영 빌드 입구에서 가져오지 않는다.
 */
const state = new URLSearchParams(location.search).get('state') ?? 'loading';
const v = testExhibitionView([3, 1]);
const view: TeacherExhibitionView = {
  exhibition: teacherExhibition({ status: 'OPEN' }),
  rooms: [teacherRoom(0), teacherRoom(1)],
  artworks: [teacherArtwork(0, 0), teacherArtwork(0, 1), teacherArtwork(0, 2), teacherArtwork(1, 0)],
  layout: v.layout,
  versions: v.versions,
};
const progressOf: Record<string, PreloadProgress> = {
  loading: { kind: 'LOADING', completed: 7, total: 19, bytes: 4_830_000 },
  ready: { kind: 'READY', completed: 19, total: 19, bytes: 14_260_000 },
  nospace: { kind: 'NO_SPACE', completed: 0, total: 19, bytes: 0 },
  unavailable: { kind: 'UNAVAILABLE', completed: 0, total: 19, bytes: 0 },
};
const media: MediaCache = {
  register: async () => true,
  appStarted: async () => {},
  screenResumed: async () => {},
  space: async () => ({ availableBytes: null, sufficient: null }),
  preload: (_view, onProgress) => {
    const p = progressOf[state] ?? progressOf.loading!;
    onProgress(p);
    return p.kind === 'LOADING' ? new Promise(() => {}) : Promise.resolve({ kind: p.kind });
  },
};
const base = teacherServices(fakeTeacher({ exhibition: async () => view })).services;
const services: AppServices = { ...base, media };

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <ServicesContext value={services}>
        <main data-theme="modern-history" style={{ minHeight: '100dvh', background: 'var(--loader-bg)' }}>
          <PreloadSheet exhibitionId={view.exhibition.id} onClose={() => {}} />
        </main>
      </ServicesContext>
    </StrictMode>,
  );
