import { type CharacterId, type ExhibitionView, ExhibitionViewSchema } from '@gallery/core/types';
import { useEffect, useState } from 'react';
import { createTokenTools } from '../src/adapters/tokens.ts';
import { VisitScreen } from '../src/app/visit/VisitScreen.tsx';
import { useWalk } from '../src/viewer/walk/walkStore.ts';

/**
 * `/dev/visit?code=123456` — 학생 관람 화면(P4-2)만 실제 개발 서버 전시로 띄운다(포스터·경로 없이 바로 들어감).
 * `tools/dev/seed-exhibition.mjs`로 만든 열린 전시의 입장 코드를 넣는다. `?character=student-f`, `?solo=1`(함께 관람 끔).
 * 함께 관람 토큰은 탭마다 새로 만든다(서버 등록 없이 익명 관람객, ADR-057 R-5).
 */
const params = new URLSearchParams(window.location.search);
const code = params.get('code') ?? '';
const character: CharacterId = params.get('character') === 'student-f' ? 'student-f' : 'student-m';
const token = params.has('solo') ? null : createTokenTools().newToken();
Object.assign(window, { __walk: useWalk });

export const VisitDev = () => {
  const [view, setView] = useState<ExhibitionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/e/${encodeURIComponent(code)}`, { signal: ac.signal })
      .then(async r => {
        const body: unknown = await r.json();
        const data = (body as { data?: unknown }).data;
        if (!r.ok || data === undefined) throw new Error(JSON.stringify(body).slice(0, 200));
        setView(ExhibitionViewSchema.parse(data));
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, []);
  if (error) return <pre data-testid="visit-dev-error">{error}</pre>;
  if (!view) return <p data-testid="visit-dev-loading">…</p>;
  return (
    <>
      <VisitScreen
        view={view}
        code={code}
        character={character}
        liveToken={token}
        entered
        onProgress={p => setProgress(p.progress)}
        onHome={() => window.location.assign('/dev')}
      />
      <output hidden data-testid="visit-dev-progress">
        {progress}
      </output>
    </>
  );
};
