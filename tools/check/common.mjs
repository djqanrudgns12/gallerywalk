import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 저장소 기본 루트 경로 */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DEFAULT_IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.local', 'coverage']);

/**
 * 기준 폴더로부터 POSIX 슬래시(`/`) 상대 경로를 만든다.
 */
export function toPosixRelative(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath);
  return rel.split(path.sep).join('/');
}

/**
 * 경로가 대상 디렉터리 안쪽을 가리키는지 확인한다.
 */
export function isInsideDir(targetDir, resolvedPath) {
  const rel = path.relative(targetDir, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 위반 한 건을 `파일:줄  규칙 이름  설명` 모양으로 포맷한다.
 */
export function formatViolation({ file, line, rule, message }) {
  return `${file}:${line}  ${rule}  ${message}`;
}

/**
 * 경고 한 건을 `파일:줄  [warn] 규칙 이름  설명` 모양으로 포맷한다.
 */
export function formatWarning({ file, line, rule, message }) {
  return `${file}:${line}  [warn] ${rule}  ${message}`;
}

/**
 * 폴더를 재귀 순회하여 조건에 맞는 파일 경로 목록을 정렬해 돌려준다.
 * 폴더가 아직 없으면 빈 배열을 돌려준다.
 */
export function walkFiles(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) return [];
  const ignoredDirs = options.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const filter = options.filter ?? (() => true);
  const results = [];

  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        visit(fullPath);
      } else if (entry.isFile()) {
        if (filter(fullPath, entry.name)) results.push(fullPath);
      }
    }
  }

  visit(dirPath);
  results.sort();
  return results;
}

/**
 * 시험 파일(`*.test.*`, `*.spec.*`)인지 판정한다.
 */
export function isTestFile(filePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

/**
 * `apps/web/dev/**` 또는 `apps/web/src/dev/**` 경로인지 판정한다.
 */
export function isWebDevFile(rootDir, filePath) {
  const rel = toPosixRelative(rootDir, filePath);
  return rel.startsWith('apps/web/dev/') || rel.startsWith('apps/web/src/dev/');
}

/**
 * CLI 인자에서 `--root <경로>`와 `--warnings` 여부를 읽는다.
 */
export function parseCliArgs(argv = process.argv.slice(2)) {
  let rootDir = REPO_ROOT;
  const idx = argv.indexOf('--root');
  if (idx !== -1 && argv[idx + 1]) {
    rootDir = path.resolve(argv[idx + 1]);
  }
  const showWarnings = argv.includes('--warnings');
  return { rootDir, showWarnings };
}

/**
 * 현재 모듈이 직접 실행되었는지 확인한다.
 */
export function isCliMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(importMetaUrl);
}

/**
 * 검사 함수를 CLI 진입점으로 실행한다.
 * 위반(`violations`)이 있을 때만 종료 코드를 1로 두고, 경고(`warnings`)는 종료 코드를 바꾸지 않는다.
 */
export function runCheckCli(checkFn, argv = process.argv.slice(2)) {
  const { rootDir, showWarnings } = parseCliArgs(argv);
  const result = checkFn({ rootDir });
  const violations = result.violations ?? [];
  const warnings = result.warnings ?? [];

  for (const v of violations) {
    console.log(formatViolation(v));
  }
  if (showWarnings) {
    for (const w of warnings) {
      console.log(formatWarning(w));
    }
  }
  process.exitCode = violations.length > 0 ? 1 : 0;
  return result;
}
