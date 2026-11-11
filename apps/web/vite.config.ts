import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/**
 * 개발 웹 4522(strictPort). `/api`·`/assets/g/m`(작품 미디어)은 개발 서버 4521로 넘긴다(PLAN §9.1).
 * 캐시할 파일은 모두 `/assets/g/` 아래에 둔다 — 글방과 CloudFront 배포를 함께 써도 경로가 겹치지 않게(ADR-002).
 * `/dev/*` 화면(관문 시험용)은 개발 서버와 `--mode devices` 빌드에만 들어간다. 운영 빌드에는 없다.
 */
const DEV_PATH = /^\/dev(?:\/[^.?]*)?(?:\?.*)?$/;

const devPages = (): Plugin => ({
  name: 'gallery-dev-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && DEV_PATH.test(req.url) && !req.url.startsWith('/dev/index.html'))
        req.url = '/dev/index.html';
      next();
    });
  },
});

/** 첫 진입의 정적 의존 파일만 설치한다. 동적 교사 묶음은 제외한다. */
const serviceWorkerManifest = (): Plugin => ({
  name: 'gallery-service-worker-manifest',
  apply: 'build',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const urls = new Set<string>(['/']);
      const visit = (name: string): void => {
        const url = `/${name}`;
        if (urls.has(url)) return;
        const item = bundle[name];
        if (!item) return;
        urls.add(url);
        if (item.type === 'chunk') {
          for (const dependency of item.imports) visit(dependency);
          for (const css of item.viteMetadata?.importedCss ?? []) visit(css);
        } else if (item.fileName.endsWith('.css')) {
          for (const asset of item.viteMetadata?.importedAssets ?? []) visit(asset);
        }
      };
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.isEntry && item.name === 'app') visit(item.fileName);
      }
      const hash = createHash('sha256');
      for (const url of [...urls].sort()) {
        const item = bundle[url === '/' ? 'index.html' : url.slice(1)];
        if (!item) throw new Error(`SW precache file missing: ${url}`);
        hash.update(url);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk') throw new Error('SW entry missing');
      const manifest = JSON.stringify({ version: hash.digest('hex'), urls: [...urls].sort() });
      const marker = /(["'`])__GALLERY_SW_MANIFEST__\1/;
      if (!marker.test(sw.code)) throw new Error('SW manifest marker missing');
      sw.code = sw.code.replace(marker, () => JSON.stringify(manifest));
    },
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), devPages(), serviceWorkerManifest()],
  resolve: { conditions: ['@gallery/source', ...defaultClientConditions] },
  server: {
    host: '127.0.0.1',
    port: 4522,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4521', ws: true },
      '/assets/g/m': 'http://127.0.0.1:4521',
    },
  },
  build: {
    target: 'es2022',
    assetsDir: 'assets/g',
    rolldownOptions: {
      input:
        mode === 'devices'
          ? { app: 'index.html', dev: 'dev/index.html', sw: 'src/sw/sw.ts' }
          : { app: 'index.html', sw: 'src/sw/sw.ts' },
      output: { entryFileNames: chunk => (chunk.name === 'sw' ? 'sw.js' : 'assets/g/[name]-[hash].js') },
    },
  },
}));
