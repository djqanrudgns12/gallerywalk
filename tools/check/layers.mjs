import path from 'node:path';
import {
  isCliMain,
  isInsideDir,
  isTestFile,
  isWebDevFile,
  REPO_ROOT,
  runCheckCli,
  toPosixRelative,
  walkFiles,
} from './common.mjs';
import { extractModuleImports, scanFile } from './scanner.mjs';

const CODE_FILE_RE = /\.[cm]?[jt]sx?$/;

const FORBIDDEN_DOM_GLOBALS = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'HTMLElement',
  'HTMLAudioElement',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'Element',
  'AudioContext',
  'Audio',
  'Image',
  'ImageBitmap',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'WebGLRenderingContext',
  'WebGL2RenderingContext',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'Worker',
  'ServiceWorker',
  'XMLHttpRequest',
  'WebSocket',
  'fetch',
]);

const FORBIDDEN_NODE_GLOBALS = new Set(['process', 'Buffer', 'require', '__dirname', '__filename', 'global']);

const DECLARATION_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'import',
  'export',
]);

const PROPERTY_PREFIX_PUNCT = new Set(['{', ',', ';', '(']);

/**
 * 토큰 스트림에서 전역 식별자 참조인지 확인한다.
 * 객체 속성 접근(`obj.window`), 객체·타입 속성 선언(`{ window: ... }`), 변수 선언 이름은 제외한다.
 */
function isGlobalIdentifierReference(tokens, index) {
  const prev = tokens[index - 1];
  const next = tokens[index + 1];

  if (prev?.type === 'punct' && (prev.value === '.' || prev.value === '?.')) {
    return false;
  }
  if (prev?.type === 'ident' && (DECLARATION_KEYWORDS.has(prev.value) || prev.value === 'readonly')) {
    return false;
  }
  if (
    next?.type === 'punct' &&
    (next.value === ':' || (next.value === '?' && tokens[index + 2]?.value === ':'))
  ) {
    if (!prev || (prev.type === 'punct' && PROPERTY_PREFIX_PUNCT.has(prev.value))) {
      return false;
    }
  }
  return true;
}

/**
 * ③ 층 위반 검사(PLAN §2.4, §14.1):
 * 1) `apps/web/src/{ui,viewer,screens}/**` → `apps/web/src/adapters/**` 가져오기 금지
 * 2) `packages/core/src/domain/**` (시험 파일 제외)에서 외부 패키지(`zod`의 `import type` 제외)·DOM·Node API 금지
 */
export function checkLayers({ rootDir = REPO_ROOT } = {}) {
  const violations = [];

  // 1. apps/web/src/{ui,viewer,screens}/** -> apps/web/src/adapters/**
  const adaptersDir = path.join(rootDir, 'apps/web/src/adapters');
  const webLayerDirs = ['ui', 'viewer', 'screens'].map(sub => path.join(rootDir, 'apps/web/src', sub));

  for (const layerDir of webLayerDirs) {
    const files = walkFiles(layerDir, {
      filter: filePath =>
        CODE_FILE_RE.test(filePath) && !isTestFile(filePath) && !isWebDevFile(rootDir, filePath),
    });

    for (const filePath of files) {
      const relFile = toPosixRelative(rootDir, filePath);
      const { tokens } = scanFile(filePath);
      const specs = extractModuleImports(tokens);

      for (const { specifier, line } of specs) {
        let importsAdapters = false;
        if (specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(filePath), specifier);
          importsAdapters = isInsideDir(adaptersDir, resolved);
        } else if (/(?:^|\/)adapters(?:\/|$)/.test(specifier)) {
          importsAdapters = true;
        }

        if (importsAdapters) {
          violations.push({
            file: relFile,
            line,
            rule: 'ui-no-adapters',
            message: `화면·부품·관람 층에서 adapters/를 직접 가져올 수 없습니다 (${specifier})`,
          });
        }
      }
    }
  }

  // 2. packages/core/src/domain/** -> 외부 패키지(zod 타입 제외)·DOM·Node API 금지 (시험 파일 제외)
  const domainDir = path.join(rootDir, 'packages/core/src/domain');
  const coreSrcDir = path.join(rootDir, 'packages/core/src');
  const coreTypesDir = path.join(rootDir, 'packages/core/src/types');
  const domainFiles = walkFiles(domainDir, {
    filter: filePath => CODE_FILE_RE.test(filePath) && !isTestFile(filePath),
  });

  for (const filePath of domainFiles) {
    const relFile = toPosixRelative(rootDir, filePath);
    const { tokens } = scanFile(filePath);
    const specs = extractModuleImports(tokens);

    for (const { specifier, line, isTypeOnly, kind } of specs) {
      // require()는 Node API이자 외부/런타임 모듈 호출이므로 바로 위반
      if (kind === 'require') {
        violations.push({
          file: relFile,
          line,
          rule: 'domain-no-external',
          message: `domain/에서 require()로 모듈을 가져올 수 없습니다 (${specifier})`,
        });
        continue;
      }

      if (!specifier.startsWith('.')) {
        const isZod = specifier === 'zod' || specifier.startsWith('zod/');
        if (isZod && isTypeOnly) {
          continue;
        }
        violations.push({
          file: relFile,
          line,
          rule: 'domain-no-external',
          message: isZod
            ? `domain/에서 zod는 import type만 허용됩니다 (${specifier})`
            : `domain/에서 외부 패키지나 Node 내장 모듈을 가져올 수 없습니다 (${specifier})`,
        });
        continue;
      }

      const resolved = path.resolve(path.dirname(filePath), specifier);
      if (!isInsideDir(coreSrcDir, resolved)) {
        violations.push({
          file: relFile,
          line,
          rule: 'domain-no-external',
          message: `domain/에서 packages/core/src 밖을 가져올 수 없습니다 (${specifier})`,
        });
      } else if (isInsideDir(coreTypesDir, resolved) && !isTypeOnly) {
        violations.push({
          file: relFile,
          line,
          rule: 'domain-no-external',
          message: `domain/에서 zod 런타임을 포함하는 types/는 import type만 허용됩니다 (${specifier})`,
        });
      }
    }

    // DOM / Node 전역 API 식별자 검사
    const reportedLineIdent = new Set();
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type !== 'ident') continue;

      const isDom = FORBIDDEN_DOM_GLOBALS.has(tok.value);
      const isNode = FORBIDDEN_NODE_GLOBALS.has(tok.value);
      if (!isDom && !isNode) continue;

      // require('...')는 이미 위에서 모듈 가져오기로 검사했더라도 domain-no-dom-node에서도 잡히지 않게 구분하거나 함께 보고
      if (!isGlobalIdentifierReference(tokens, i)) continue;

      const key = `${tok.line}:${tok.value}`;
      if (reportedLineIdent.has(key)) continue;
      reportedLineIdent.add(key);

      violations.push({
        file: relFile,
        line: tok.line,
        rule: 'domain-no-dom-node',
        message: `domain/에서 ${isDom ? 'DOM' : 'Node'} API(${tok.value})를 쓸 수 없습니다`,
      });
    }
  }

  return { violations, warnings: [] };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkLayers);
}
