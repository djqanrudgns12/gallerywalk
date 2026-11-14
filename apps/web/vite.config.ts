import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
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

/**
 * pdf.js가 PDF를 열 때 읽는 자원(CMap·표준 글꼴·wasm 해독기·ICC)을 같은 출처에 둔다(PLAN §5.3 — 외부 주소 금지).
 * 저장소에 복사해 두지 않고 설치된 `pdfjs-dist`에서 바로 내보내 판이 늘 같다. 판 번호가 경로에 들어가
 * `/assets/g/`의 오래 두는 캐시(immutable)와 겹치지 않는다. 쓰는 곳은 `src/app/teacher/upload/pdfjs.ts`.
 * 묶음(`bundle`)에 들어가지만 어떤 진입 파일도 가져오지 않아 서비스 워커 미리 받기 목록에는 없다.
 */
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;
const PDFJS_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const PDFJS_TYPES: Readonly<Record<string, string>> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
};

const pdfjsAssets = (): Plugin => {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const prefix = `/assets/g/pdfjs/${version}/`;
  const files = (): { dir: string; name: string }[] =>
    PDFJS_DIRS.flatMap(dir =>
      readdirSync(join(root, dir))
        .filter(name => PDFJS_FILE.test(name))
        .map(name => ({ dir, name })),
    );
  return {
    name: 'gallery-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!path.startsWith(prefix)) return next();
        const [dir, name, ...rest] = path.slice(prefix.length).split('/');
        if (!PDFJS_DIRS.some(d => d === dir) || !name || !PDFJS_FILE.test(name) || rest.length > 0)
          return next();
        const file = join(root, dir ?? '', name);
        if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
        res.setHeader('Content-Type', PDFJS_TYPES[extname(name)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const { dir, name } of files())
        this.emitFile({
          type: 'asset',
          fileName: `${prefix.slice(1)}${dir}/${name}`,
          source: readFileSync(join(root, dir, name)),
        });
    },
  };
};

/** 첫 진입의 정적 의존 파일만 설치한다. 동적 교사 묶음은 제외한다. */
const serviceWorkerManifest = (): Plugin => ({
  name: 'gallery-service-worker-manifest',
  apply: 'build',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const urls = new Set<string>(['/']);
      const visit = (name: string): void => {
        // 글꼴 조각(U-21, unicode-range로 수백 개)은 미리 저장하지 않는다 — 브라우저가 쓰는 글자의 조각만 받는다
        if (/\.(woff2?|ttf|otf)$/.test(name)) return;
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
  plugins: [react(), devPages(), pdfjsAssets(), serviceWorkerManifest()],
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
    // 학교 기기(G-24 HW-05): 오래된 iPad Safari 15·삼성 인터넷(Chromium 90대)에서도 묶음이 해석되게 문법만 낮춘다
    // (class static block 등). 실행 기능(`Object.hasOwn`·`.at()` 등)은 코드에서 쓰지 않는다 — `check:rules`가 본다
    target: ['safari15', 'chrome90', 'firefox90', 'edge90'],
    assetsDir: 'assets/g',
    // 글꼴은 작아도 `data:`로 넣지 않는다 — 운영 CSP `font-src 'self'`가 막아 그 글자 조각이 빠진다(ADR-069)
    assetsInlineLimit: (filePath: string) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
    rolldownOptions: {
      input:
        mode === 'devices'
          ? { app: 'index.html', dev: 'dev/index.html', sw: 'src/sw/sw.ts' }
          : { app: 'index.html', sw: 'src/sw/sw.ts' },
      output: { entryFileNames: chunk => (chunk.name === 'sw' ? 'sw.js' : 'assets/g/[name]-[hash].js') },
    },
  },
}));
