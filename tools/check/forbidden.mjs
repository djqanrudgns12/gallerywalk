import fs from 'node:fs';
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
import { scanFile, stripCssComments } from './scanner.mjs';

const EMOJI_RE = /\p{Emoji_Presentation}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const HANGUL_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u11FF\u3130-\u318F]/;
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|css|html|json)$/;
const CODE_FILE_RE = /\.[cm]?[jt]sx?$/;
const JSX_OR_HTML_RE = /\.(?:[jt]sx|html)$/;
const CSS_HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const CSS_BACKDROP_RE = /\b(?:-webkit-)?backdrop-filter\s*:/i;
const INLINE_BACKDROP_RE = /\b(?:backdropFilter|(?:-webkit-)?backdrop-filter)\b/;

/**
 * CSS 파일이 hex 색 허용 경로(`apps/web/src/ui/tokens.css`, `apps/web/src/ui/themes/*.css`, `apps/web/dev/**`)인지 확인한다.
 */
function isAllowedHexCssFile(rootDir, filePath) {
  if (isWebDevFile(rootDir, filePath)) return true;
  const rel = toPosixRelative(rootDir, filePath);
  if (rel === 'apps/web/src/ui/tokens.css') return true;
  const themesDir = path.join(rootDir, 'apps/web/src/ui/themes');
  return isInsideDir(themesDir, filePath) && filePath.endsWith('.css');
}

/**
 * ① 화면·부품 파일(`apps/web/src/{app,screens,ui,viewer}/**`)의 한국어 문자열 리터럴 금지
 * (주석·throw 예외 문 제외, `apps/web/dev/**` 및 시험 파일 제외)
 */
function checkInlineKorean(rootDir, violations) {
  const targetDirs = ['app', 'screens', 'ui', 'viewer'].map(sub => path.join(rootDir, 'apps/web/src', sub));

  for (const dir of targetDirs) {
    const files = walkFiles(dir, {
      filter: filePath =>
        CODE_FILE_RE.test(filePath) &&
        !isTestFile(filePath) &&
        !isWebDevFile(rootDir, filePath) &&
        !filePath.endsWith('icons.generated.tsx'),
    });

    for (const filePath of files) {
      const relFile = toPosixRelative(rootDir, filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const { tokens, strippedText } = scanFile(filePath, content);
      const reportedLines = new Set();

      for (const tok of tokens) {
        if ((tok.type === 'string' || tok.type === 'template') && !tok.inThrow) {
          if (HANGUL_RE.test(tok.value)) {
            reportedLines.add(tok.line);
            violations.push({
              file: relFile,
              line: tok.line,
              rule: 'no-inline-korean',
              message: `화면·부품 파일에 한국어 문자열을 직접 쓸 수 없습니다 (${JSON.stringify(tok.value.trim())})`,
            });
          }
        }
      }

      // JSX 텍스트 노드(주석·문자열·템플릿을 걷어낸 뒤 남은 한글) 검사
      const strippedLines = strippedText.split('\n');
      for (let i = 0; i < strippedLines.length; i++) {
        const lineNo = i + 1;
        if (reportedLines.has(lineNo)) continue;
        const lineStr = strippedLines[i] ?? '';
        if (HANGUL_RE.test(lineStr)) {
          const snippet = lineStr.replace(/<[^>]*>/g, ' ').trim();
          violations.push({
            file: relFile,
            line: lineNo,
            rule: 'no-inline-korean',
            message: `화면·부품 파일에 한국어 문구를 직접 쓸 수 없습니다 (${JSON.stringify(snippet || lineStr.trim())})`,
          });
        }
      }
    }
  }
}

/**
 * ② CSS hex 색 금지 (`apps/web/src/ui/tokens.css`, `apps/web/src/ui/themes/*.css`, `apps/web/dev/**` 예외)
 * 및 ④ CSS `backdrop-filter` 금지
 */
function checkCssFiles(rootDir, violations) {
  const dirs = [path.join(rootDir, 'apps'), path.join(rootDir, 'packages')];

  for (const baseDir of dirs) {
    const cssFiles = walkFiles(baseDir, {
      filter: filePath => filePath.endsWith('.css'),
    });

    for (const filePath of cssFiles) {
      const relFile = toPosixRelative(rootDir, filePath);
      const raw = fs.readFileSync(filePath, 'utf8');
      const stripped = stripCssComments(raw);
      const lines = stripped.split('\n');
      const allowHex = isAllowedHexCssFile(rootDir, filePath);

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i] ?? '';
        const lineNo = i + 1;

        if (!allowHex) {
          const hexMatch = lineText.match(CSS_HEX_COLOR_RE);
          if (hexMatch) {
            violations.push({
              file: relFile,
              line: lineNo,
              rule: 'no-css-hex-color',
              message: `tokens.css·themes/*.css 밖에서는 CSS hex 색을 쓸 수 없습니다 (${hexMatch[0]})`,
            });
          }
        }

        if (CSS_BACKDROP_RE.test(lineText)) {
          violations.push({
            file: relFile,
            line: lineNo,
            rule: 'no-backdrop-filter',
            message: 'backdrop-filter(유리 효과)는 쓸 수 없습니다',
          });
        }
      }
    }
  }
}

/**
 * ④ 기본 `<select>`·인라인 `backdrop-filter`·이모지 금지
 */
function checkForbiddenElementsAndEmoji(rootDir, violations) {
  const dirs = [path.join(rootDir, 'packages'), path.join(rootDir, 'apps')];

  for (const baseDir of dirs) {
    const files = walkFiles(baseDir, {
      filter: filePath => SOURCE_FILE_RE.test(filePath) && !isTestFile(filePath),
    });

    for (const filePath of files) {
      const relFile = toPosixRelative(rootDir, filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const rawLines = content.split('\n');

      // 이모지 검사
      for (let i = 0; i < rawLines.length; i++) {
        const m = rawLines[i]?.match(EMOJI_RE);
        if (m) {
          violations.push({
            file: relFile,
            line: i + 1,
            rule: 'no-emoji',
            message: `이모지를 쓸 수 없습니다 (${m[0]})`,
          });
        }
      }

      // TS/TSX/JS/JSX의 <select> 및 인라인 backdropFilter 검사
      if (CODE_FILE_RE.test(filePath)) {
        const { tokens, strippedText } = scanFile(filePath, content);
        const strippedLines = strippedText.split('\n');

        if (JSX_OR_HTML_RE.test(filePath)) {
          for (let i = 0; i < strippedLines.length; i++) {
            if (/<select(?=[\s>/])/i.test(strippedLines[i] ?? '')) {
              violations.push({
                file: relFile,
                line: i + 1,
                rule: 'no-native-select',
                message: '기본 <select> 요소는 쓸 수 없습니다',
              });
            }
          }
        }

        const backdropLines = new Set();
        for (const tok of tokens) {
          if (
            (tok.type === 'ident' && tok.value === 'backdropFilter') ||
            (tok.type === 'string' && CSS_BACKDROP_RE.test(`${tok.value}:`)) ||
            (tok.type === 'string' && INLINE_BACKDROP_RE.test(tok.value))
          ) {
            if (!backdropLines.has(tok.line)) {
              backdropLines.add(tok.line);
              violations.push({
                file: relFile,
                line: tok.line,
                rule: 'no-backdrop-filter',
                message: 'backdrop-filter(유리 효과)는 쓸 수 없습니다',
              });
            }
          }
        }
      } else if (filePath.endsWith('.html')) {
        const noHtmlComments = content.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
        const htmlLines = noHtmlComments.split('\n');
        for (let i = 0; i < htmlLines.length; i++) {
          if (/<select(?=[\s>/])/i.test(htmlLines[i] ?? '')) {
            violations.push({
              file: relFile,
              line: i + 1,
              rule: 'no-native-select',
              message: '기본 <select> 요소는 쓸 수 없습니다',
            });
          }
        }
      }
    }
  }
}

/**
 * ①·②·④ 금지 규칙을 모두 검사한다.
 */
export function checkForbidden({ rootDir = REPO_ROOT } = {}) {
  const violations = [];
  checkInlineKorean(rootDir, violations);
  checkCssFiles(rootDir, violations);
  checkForbiddenElementsAndEmoji(rootDir, violations);
  return { violations, warnings: [] };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkForbidden);
}
