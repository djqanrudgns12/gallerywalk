import { type JSX, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioDev } from './AudioDev.tsx';
import { CharactersDev } from './CharactersDev.tsx';
import { HashDev } from './HashDev.tsx';
import { SeamDev } from './SeamDev.tsx';
import { ViewerDev } from './ViewerDev.tsx';
import { VisitDev } from './VisitDev.tsx';
import { WalkDev } from './WalkDev.tsx';
import { PatternsDev } from './PatternsDev.tsx';

/**
 * 개발 화면 묶음(`/dev/*`). 개발 서버와 `--mode devices` 빌드에만 들어가고 운영 빌드에는 없다(vite.config.ts).
 * - `/dev/viewer`: 관람 엔진 뼈대(P1-4)
 * - `/dev/walk`: 자유 관람(ADR-057, R-1) — 광장·계단·전시관, 캐릭터 걷기
 * - `/dev/visit?code=`: 학생 관람 화면(P4-2)을 개발 서버의 열린 전시로
 * - `/dev/characters`: 캐릭터 4종 검수(R-4, 규격 tools/assets/spec/characters.md)
 * - `/dev/audio`: 소리 엔진(P1-6)
 * - `/dev/seam`: 템플릿 조각 이음새 시험(P1-3, PLAN §13.3)
 * - `/dev/hash`: 런타임 간 배치 해시 비교(P2-3, PLAN §4.11)
 * - `/dev/pages`: 쪽 나눔 확인 화면(P1-5b 계획기는 끝남, 화면은 P1-5a 처리와 함께)
 */
const pages: Record<string, () => JSX.Element> = {
  '/dev/viewer': ViewerDev,
  '/dev/walk': WalkDev,
  '/dev/visit': VisitDev,
  '/dev/characters': CharactersDev,
  '/dev/audio': AudioDev,
  '/dev/seam': SeamDev,
  '/dev/hash': HashDev,
  '/dev/patterns': PatternsDev,
};

const DevIndex = () => (
  <ul>
    {Object.keys(pages).map(path => (
      <li key={path}>
        <a href={path}>{path}</a>
      </li>
    ))}
  </ul>
);

const Page = pages[window.location.pathname.replace(/\/$/, '')] ?? DevIndex;
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
