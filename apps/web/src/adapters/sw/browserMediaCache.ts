import coreUrl from '../../tpl/modern-history/core.glb?url';
import exteriorUrl from '../../tpl/modern-history/exterior.glb?url';
import fixturesUrl from '../../tpl/modern-history/fixtures.glb?url';
import type { MediaCache } from '../../ports/mediaCache.ts';
import { browserWorkerConnection } from './connection.ts';
import { createMediaCache } from './mediaCache.ts';

/** main.tsx에서 한 번 만들어 포스터·앱 수명 주기에 주입한다. */
export const createBrowserMediaCache = (): MediaCache =>
  createMediaCache({
    production: import.meta.env.PROD,
    pathname: location.pathname,
    connection: 'serviceWorker' in navigator ? browserWorkerConnection(navigator.serviceWorker) : null,
    estimate: async () => (navigator.storage?.estimate ? navigator.storage.estimate() : {}),
    templates: { 'modern-history': [exteriorUrl, coreUrl, fixturesUrl] },
  });
