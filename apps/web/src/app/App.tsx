import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import './App.module.css';
import { PRIVACY_PATH } from './privacy/path.ts';
import { entryCodeOf, PATHS } from './routes.ts';
import { type AppServices, appServices, ServicesContext } from './services.ts';
import { HomeScreen } from './student/HomeScreen.tsx';
import { StudentExhibition } from './student/StudentExhibition.tsx';

/**
 * 앱 뿌리와 경로(PLAN §7.1).
 * - `/` 첫 화면 · `/{6자리}` 학생 전시 · `/t/*` 교사(지연 로드 — 교사 코드가 학생 묶음에 들어가지 않게) · 그 밖은 `/`.
 * - `/privacy` 개인정보처리방침(학생·교사 공통, 지연 로드, P6-8).
 */

const TeacherApp = lazy(() => import('./teacher/TeacherApp.tsx').then(m => ({ default: m.TeacherApp })));
const PrivacyScreen = lazy(() =>
  import('./privacy/PrivacyScreen.tsx').then(m => ({ default: m.PrivacyScreen })),
);

const ExhibitionRoute = () => {
  const code = entryCodeOf(useParams().code);
  return code ? <StudentExhibition key={code} code={code} /> : <Navigate to={PATHS.home} replace />;
};

export const AppRoutes = () => (
  <Routes>
    <Route path={PATHS.home} element={<HomeScreen />} />
    <Route
      path={`${PATHS.teacher}/*`}
      element={
        <Suspense fallback={null}>
          <TeacherApp />
        </Suspense>
      }
    />
    <Route
      path={PRIVACY_PATH}
      element={
        <Suspense fallback={null}>
          <PrivacyScreen />
        </Suspense>
      }
    />
    <Route path="/:code" element={<ExhibitionRoute />} />
    <Route path="*" element={<Navigate to={PATHS.home} replace />} />
  </Routes>
);

/**
 * 서비스 워커(P4-8, §9.6): 등록 → 앱 시작 알림(지난 전시 캐시 정리), 화면에 돌아올 때마다 다시 알림.
 * 운영 빌드에서만 실제로 등록한다(구현이 `import.meta.env.PROD`를 본다).
 */
const useMediaLifecycle = (services: AppServices): void => {
  useEffect(() => {
    const media = services.media;
    if (!media) return;
    void media.register().then(ok => (ok ? media.appStarted() : undefined));
    const back = (): void => {
      if (document.visibilityState === 'visible') void media.screenResumed();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [services]);
};

/**
 * 앱 시작 때 한 번: 최근 전시 목록을 읽으면 지난 전시의 방문자 토큰·별명과 교사 세션을 기기에서 지운다
 * (`deviceStore.readRecent`, ADR-062 — 전시를 하나도 열지 않아도 정리되게)
 */
const useDeviceSweep = (services: AppServices): void => {
  useEffect(() => {
    services.device.recentExhibitions();
  }, [services]);
};

export const App = () => {
  const services = appServices();
  useMediaLifecycle(services);
  useDeviceSweep(services);
  return (
    <BrowserRouter>
      <ServicesContext value={services}>
        <AppRoutes />
      </ServicesContext>
    </BrowserRouter>
  );
};
