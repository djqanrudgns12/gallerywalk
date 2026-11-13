import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
// 화면 글꼴(U-21, OFL, 자체 배포): 본문 Pretendard(가변) · 제목 Hahmlet 600·700 — 글자 범위별 조각이라 쓰는 것만 받는다
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/hahmlet/600.css';
import '@fontsource/hahmlet/700.css';
import './ui/tokens.css';
import './ui/themes/modern-history.css';
import './ui/themes/gallery-dark.css';

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
