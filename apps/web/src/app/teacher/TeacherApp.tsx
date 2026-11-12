import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { TeacherHome } from './home/TeacherHome.tsx';
import { NewExhibition } from './home/NewExhibition.tsx';
import { ManageExhibition } from './manage/ManageExhibition.tsx';

/**
 * 교사 화면(PLAN §7.1·§7.4). `App.tsx`가 `React.lazy`로만 가져온다 — 교사 화면·pdf.js·QR·끌어 옮기기가 학생 묶음에
 * 들어가지 않게(PLAN §2.5). 학생 코드에서 이 폴더를 가져오지 않는다.
 *
 * 경로(이 파일 안은 `/t` 아래 상대 경로):
 * - `/t` 첫 화면(최근 전시 카드·PIN으로 들어가기·새 전시 만들기). `/t#{토큰}`(선생님 링크)도 여기서 처리한다(`home/`).
 * - `/t/new` 새 전시 만들기(`home/`)
 * - `/t/e/:id` 전시 관리(작품 탭·반응 탭, `manage/`)
 * - `/t/e/:id/tour` 자동 투어(Claude, P5-9) — 3D 묶음이라 따로 늦게 받는다
 */
const TourScreen = lazy(() => import('./tour/TourScreen.tsx').then(m => ({ default: m.TourScreen })));

export const TeacherApp = () => (
  <main data-testid="teacher-app" data-theme="modern-history">
    <Routes>
      <Route index element={<TeacherHome />} />
      <Route path="new" element={<NewExhibition />} />
      <Route path="e/:id" element={<ManageExhibition />} />
      <Route
        path="e/:id/tour"
        element={
          <Suspense fallback={null}>
            <TourScreen />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/t" replace />} />
    </Routes>
  </main>
);
