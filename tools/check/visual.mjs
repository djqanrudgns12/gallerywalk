import fs from 'node:fs';
import path from 'node:path';
import {
  isCliMain,
  isTestFile,
  isWebDevFile,
  REPO_ROOT,
  runCheckCli,
  toPosixRelative,
  walkFiles,
} from './common.mjs';
import { scanFile, stripCssComments } from './scanner.mjs';

/**
 * ⑦ UI 그라데이션·순검정 금지 (AGENTS.md §3, PRD 9.6, FIELD_PLAN §5.4 끝 조건, HT-14).
 *
 * - 대상: `apps/web/src/ui/**`·`apps/web/src/app/**`의 `*.css`·`*.ts`·`*.tsx`.
 *   `apps/web/src/viewer/**`(3D 장면·재질)는 UI가 아니므로 보지 않는다.
 * - 빼는 것: 시험 파일(`*.test.*`·`*.spec.*`), `tests/`·`__tests__/`·`dev/` 아래, 주석.
 * - 그라데이션: `linear-|radial-|conic-gradient(`, `repeating-*-gradient(`, 공급자 접두(`-webkit-` 등). 캔버스 그리기
 *   (`createLinearGradient` 등)는 UI 장식이 아니고 이름 꼴도 달라 잡히지 않는다.
 * - 순검정: `#000`·`#000f`·`#000000`·`#000000ff`, `rgb(0,0,0)`·`rgba(0,0,0,1)`(공백 문법·`/ 1`·`100%` 포함),
 *   색 자리의 낱말 `black`. 그림자의 투명 검정(`rgba(0,0,0,.2)`)과 완전 투명(`#0000`)은 허용한다.
 *   낱말 `black`은 색을 받는 속성 값(CSS 선언, 스타일 객체 키, SVG `fill`/`stroke` 속성 등)에서만 잡아
 *   변수 이름·주석·글자 문구·글꼴 이름을 오탐하지 않는다.
 */

const TARGET_DIRS = ['apps/web/src/ui', 'apps/web/src/app'];
const TARGET_FILE_RE = /\.(?:css|tsx?)$/;
const CODE_FILE_RE = /\.tsx?$/;
const EXCLUDED_SEGMENTS = new Set(['tests', '__tests__', 'dev']);

const GRADIENT_RE =
  /(?<![\w-])(?:-(?:webkit|moz|ms|o)-)?(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi;
const HEX_BLACK_RE = /#(?:000000(?:ff)?|000f?)(?![0-9a-f])/gi;
const RGB_BLACK_RE =
  /(?<![\w-])rgba?\(\s*0%?\s*(?:,\s*|\s+)0%?\s*(?:,\s*|\s+)0%?\s*(?:[,/]\s*(?:1(?:\.0*)?|100%)\s*)?\)/gi;
const BLACK_WORD_RE = /(?<![\w$#.-])black(?![\w-])/gi;

/**
 * 색을 받는 속성 이름(CSS kebab·JS camel 모두). 사용자 정의 속성(`--x`)은 따로 본다.
 */
const COLOR_PROP_RE =
  /^(?:-?webkit-?)?(?:color|background(?:-?(?:color|image))?|border(?:-?(?:top|right|bottom|left|block|inline)(?:-?(?:start|end))?)?(?:-?color)?|outline(?:-?color)?|(?:box|text)-?shadow|fill|stroke|stop-?color|flood-?color|lighting-?color|caret-?color|accent-?color|column-?rule(?:-?color)?|text-?decoration(?:-?color)?|text-?emphasis(?:-?color)?|text-?stroke(?:-?color)?|text-?fill-?color|scrollbar-?color|filter|fill-?style|stroke-?style|shadow-?color)$/i;

/**
 * 따로 둘 예외: 파일·줄·규칙이 모두 맞을 때만 뺀다. 넣을 때는 이유를 반드시 적는다.
 * (2026-11-14 HT-14 도입 시점: 지금 저장소에 위반이 없어 비어 있다.)
 * @type {ReadonlyArray<{ file: string, line: number, rule: 'no-ui-gradient' | 'no-pure-black', reason: string }>}
 */
export const VISUAL_ALLOWLIST = [];

function isExcludedFile(rootDir, filePath) {
  if (isTestFile(filePath) || isWebDevFile(rootDir, filePath)) return true;
  const segments = toPosixRelative(rootDir, filePath).split('/');
  return segments.slice(0, -1).some(seg => EXCLUDED_SEGMENTS.has(seg));
}

/** 따옴표 문자열과 `url(...)`을 같은 길이 공백으로 가려 위치(줄)를 보존한다. */
function maskStringsAndUrls(text) {
  return text
    .replace(/url\([^)]*\)/gi, m => m.replace(/[^\n]/g, ' '))
    .replace(/'[^'\n]*'|"[^"\n]*"/g, m => m.replace(/[^\n]/g, ' '));
}

function lineAt(text, index, baseLine = 1) {
  let line = baseLine;
  for (let k = 0; k < index && k < text.length; k++) {
    if (text[k] === '\n') line++;
  }
  return line;
}

/** 정규식이 맞는 자리마다 [자리, 맞은 글]을 돌려준다. */
function matchesOf(re, text) {
  re.lastIndex = 0;
  return Array.from(text.matchAll(re), m => [m.index ?? 0, m[0]]);
}

/**
 * CSS 글(파일 전체 또는 문자열 안 CSS)에서 선언(`속성: 값`)을 찾아, 색을 받는 속성이나 사용자 정의 속성의 값에서
 * 낱말 `black`의 자리를 돌려준다. 선택자·@규칙 머리(`{` 앞)는 보지 않는다.
 */
function blackWordInDeclarations(cssText) {
  const hits = [];
  let segStart = 0;
  for (let i = 0; i <= cssText.length; i++) {
    const ch = cssText[i];
    if (i < cssText.length && ch !== '{' && ch !== '}' && ch !== ';') continue;
    const endedByBrace = ch === '{';
    const segment = cssText.slice(segStart, i);
    if (!endedByBrace) {
      const colon = segment.indexOf(':');
      if (colon > 0) {
        const prop = segment.slice(0, colon).trim();
        const isProp = /^-{0,2}[a-zA-Z][\w-]*$/.test(prop);
        if (isProp && (prop.startsWith('--') || COLOR_PROP_RE.test(prop))) {
          const valueStart = segStart + colon + 1;
          const value = maskStringsAndUrls(segment.slice(colon + 1));
          for (const [at, text] of matchesOf(BLACK_WORD_RE, value)) {
            hits.push([valueStart + at, text]);
          }
        }
      }
    }
    segStart = i + 1;
  }
  return hits;
}

function gradientViolation(file, line, text) {
  return {
    file,
    line,
    rule: 'no-ui-gradient',
    message: `UI에는 그라데이션을 쓸 수 없습니다. 깊이는 면의 밝기 차이와 그림자 토큰으로 냅니다 (${text.replace(/\s*\($/, '')})`,
  };
}

function blackViolation(file, line, text) {
  return {
    file,
    line,
    rule: 'no-pure-black',
    message: `UI에는 순검정을 쓸 수 없습니다. 먹색 토큰(--plate-ink·--manage-ink 등)을 씁니다 (${text})`,
  };
}

function checkCssFile(relFile, raw, out) {
  const stripped = stripCssComments(raw);
  for (const [at, text] of matchesOf(GRADIENT_RE, stripped)) {
    out.push(gradientViolation(relFile, lineAt(stripped, at), text));
  }
  for (const re of [HEX_BLACK_RE, RGB_BLACK_RE]) {
    for (const [at, text] of matchesOf(re, stripped)) {
      out.push(blackViolation(relFile, lineAt(stripped, at), text));
    }
  }
  for (const [at, text] of blackWordInDeclarations(stripped)) {
    out.push(blackViolation(relFile, lineAt(stripped, at), text));
  }
}

/** 문자열 토큰 앞이 `색속성 :` 또는 `색속성 =`(스타일 객체 키·JSX/SVG 속성·캔버스 칠)인지 */
function isColorValuePosition(tokens, index) {
  const op = tokens[index - 1];
  const key = tokens[index - 2];
  if (!op || !key || op.type !== 'punct' || (op.value !== ':' && op.value !== '=')) return false;
  if (key.type !== 'ident' && key.type !== 'string') return false;
  return key.value.startsWith('--') || COLOR_PROP_RE.test(key.value);
}

function checkCodeFile(relFile, content, out) {
  const { tokens } = scanFile(relFile, content);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'string' && tok.type !== 'template') continue;
    const value = String(tok.value ?? '');
    const seen = new Set();
    const push = (violation, at) => {
      const key = `${violation.rule}:${at}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(violation);
    };

    for (const [at, text] of matchesOf(GRADIENT_RE, value)) {
      push(gradientViolation(relFile, lineAt(value, at, tok.line), text), `g${at}`);
    }
    for (const re of [HEX_BLACK_RE, RGB_BLACK_RE]) {
      for (const [at, text] of matchesOf(re, value)) {
        push(blackViolation(relFile, lineAt(value, at, tok.line), text), `b${at}`);
      }
    }
    // 낱말 black: ① 색 속성 값 자리의 문자열 ② 문자열 안에 쓴 CSS 선언
    if (isColorValuePosition(tokens, i)) {
      for (const [at, text] of matchesOf(BLACK_WORD_RE, maskStringsAndUrls(value))) {
        push(blackViolation(relFile, lineAt(value, at, tok.line), text), `b${at}`);
      }
    }
    for (const [at, text] of blackWordInDeclarations(value)) {
      push(blackViolation(relFile, lineAt(value, at, tok.line), text), `b${at}`);
    }
  }
}

/**
 * ⑦ 그라데이션·순검정 검사. `allowlist`로 파일·줄 예외를 줄 수 있고, 맞는 위반이 없는 예외는 경고로 알린다.
 */
export function checkVisual({ rootDir = REPO_ROOT, allowlist = VISUAL_ALLOWLIST } = {}) {
  const found = [];
  for (const sub of TARGET_DIRS) {
    const files = walkFiles(path.join(rootDir, sub), {
      filter: filePath => TARGET_FILE_RE.test(filePath) && !isExcludedFile(rootDir, filePath),
    });
    for (const filePath of files) {
      const relFile = toPosixRelative(rootDir, filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      if (CODE_FILE_RE.test(filePath)) checkCodeFile(relFile, content, found);
      else checkCssFile(relFile, content, found);
    }
  }

  const used = new Set();
  const violations = found.filter(v => {
    const idx = allowlist.findIndex(a => a.file === v.file && a.line === v.line && a.rule === v.rule);
    if (idx === -1) return true;
    used.add(idx);
    return false;
  });
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));

  const warnings = allowlist
    .map((a, idx) => ({ a, idx }))
    .filter(({ idx }) => !used.has(idx))
    .map(({ a }) => ({
      file: a.file,
      line: a.line,
      rule: 'stale-visual-allowlist',
      message: `허용 목록 항목에 맞는 위반이 없습니다. 줄이 바뀌었거나 고쳐졌으면 항목을 지웁니다 (${a.rule})`,
    }));

  return { violations, warnings };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkVisual);
}
