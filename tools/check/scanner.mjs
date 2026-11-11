import fs from 'node:fs';

const IDENT_START_RE = /[A-Za-z_$]/;
const IDENT_PART_RE = /[A-Za-z0-9_$]/;
const DIGIT_RE = /[0-9]/;

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'typeof',
  'void',
  'delete',
  'in',
  'instanceof',
  'new',
  'await',
  'yield',
  'of',
]);

const REGEX_PRECEDING_PUNCT = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '~',
  '^',
  '+',
  '-',
  '*',
  '%',
  '<',
  '<=',
  '>=',
  '==',
  '!=',
  '===',
  '!==',
  '&&',
  '||',
  '??',
  '=>',
  '...',
  '${',
]);

const STATEMENT_END_KEYWORDS = new Set([
  'import',
  'export',
  'const',
  'let',
  'var',
  'function',
  'class',
  'interface',
  'return',
  'if',
  'for',
  'while',
  'switch',
  'try',
]);

/**
 * CSS 블록 주석을 줄바꿈만 남기고 공백으로 지워 줄 번호를 보존한다.
 */
export function stripCssComments(cssText) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
}

/**
 * 현재 위치의 `/`가 정규식 리터럴의 시작일 수 있는지 판정한다.
 */
function canStartRegex(prevToken) {
  if (!prevToken) return true;
  if (prevToken.type === 'ident') {
    return REGEX_PRECEDING_KEYWORDS.has(prevToken.value);
  }
  if (prevToken.type === 'punct') {
    if (prevToken.value === '!' && prevToken.isPostfixNonNull) return false;
    return REGEX_PRECEDING_PUNCT.has(prevToken.value);
  }
  return false;
}

/**
 * `index` 위치의 `/`에서 시작하는 한 줄 정규식 리터럴(`/pattern/flags`)을 찾는다.
 * 같은 줄 안에서 닫히고 유효한 플래그(`dgimsuvy`)만 뒤따를 때만 정규식으로 인정한다.
 */
function matchRegexLiteral(text, startIdx) {
  const len = text.length;
  let i = startIdx + 1;
  let inCharClass = false;

  while (i < len) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') return null;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      inCharClass = true;
      i++;
      continue;
    }
    if (ch === ']' && inCharClass) {
      inCharClass = false;
      i++;
      continue;
    }
    if (ch === '/' && !inCharClass) {
      i++;
      const flagStart = i;
      while (i < len && IDENT_PART_RE.test(text[i])) i++;
      const flags = text.slice(flagStart, i);
      if (!/^[dgimsuvy]*$/.test(flags)) return null;
      return { raw: text.slice(startIdx, i), endIdx: i };
    }
    i++;
  }
  return null;
}

/**
 * 템플릿 리터럴 조각을 `` ` `` 또는 `${`까지 읽는다.
 */
function readTemplateChunk(text, startIdx, startLine) {
  const len = text.length;
  let i = startIdx;
  let line = startLine;
  let value = '';

  while (i < len) {
    const ch = text[i];
    if (ch === '`') {
      return {
        value,
        raw: text.slice(startIdx, i),
        endIdx: i + 1,
        endLine: line,
        closedBy: '`',
      };
    }
    if (ch === '$' && text[i + 1] === '{') {
      return {
        value,
        raw: text.slice(startIdx, i),
        endIdx: i + 2,
        endLine: line,
        closedBy: '${',
      };
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '\n') line++;
      value += next ?? '';
      i += 2;
      continue;
    }
    if (ch === '\n') line++;
    value += ch;
    i++;
  }

  return {
    value,
    raw: text.slice(startIdx, i),
    endIdx: i,
    endLine: line,
    closedBy: 'eof',
  };
}

/**
 * TS/TSX/JS/JSX 소스를 토큰화하고 주석·문자열·템플릿을 걷어낸 코드 사본(줄 번호 보존)도 함께 만든다.
 */
export function tokenizeSource(content) {
  const len = content.length;
  const tokens = [];
  const modeStack = [{ type: 'code', braceDepth: 0 }];
  const strippedChars = Array.from(content);

  function blankRange(from, to) {
    for (let k = from; k < to; k++) {
      if (strippedChars[k] !== '\n') strippedChars[k] = ' ';
    }
  }

  let i = 0;
  let line = 1;

  function emitTemplateFrom(chunkStartIdx) {
    const chunkStartLine = line;
    const chunk = readTemplateChunk(content, chunkStartIdx, line);
    blankRange(chunkStartIdx - 1, chunk.endIdx);
    tokens.push({
      type: 'template',
      value: chunk.value,
      raw: chunk.raw,
      line: chunkStartLine,
    });
    i = chunk.endIdx;
    line = chunk.endLine;
    if (chunk.closedBy === '${') {
      modeStack.push({ type: 'template_expr', braceDepth: 0 });
      tokens.push({ type: 'punct', value: '${', line });
    }
  }

  while (i < len) {
    const ch = content[i];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f') {
      i++;
      continue;
    }

    // 한 줄 주석 //
    if (ch === '/' && content[i + 1] === '/') {
      const start = i;
      i += 2;
      while (i < len && content[i] !== '\n') i++;
      blankRange(start, i);
      continue;
    }

    // 블록 주석 /* ... */
    if (ch === '/' && content[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') line++;
        i++;
      }
      if (i < len) i += 2;
      blankRange(start, i);
      continue;
    }

    // 문자열 리터럴 '...' 또는 "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      const startLine = line;
      let value = '';
      i++;
      while (i < len && content[i] !== quote) {
        if (content[i] === '\\') {
          const next = content[i + 1];
          if (next === '\n') line++;
          value += next ?? '';
          i += 2;
          continue;
        }
        if (content[i] === '\n') line++;
        value += content[i];
        i++;
      }
      if (i < len) i++;
      const raw = content.slice(start, i);
      blankRange(start, i);
      tokens.push({ type: 'string', value, raw, line: startLine });
      continue;
    }

    // 템플릿 리터럴 `...`
    if (ch === '`') {
      i++;
      emitTemplateFrom(i);
      continue;
    }

    const currentMode = modeStack[modeStack.length - 1];
    if (ch === '{') {
      currentMode.braceDepth++;
      tokens.push({ type: 'punct', value: '{', line });
      i++;
      continue;
    }
    if (ch === '}') {
      if (currentMode.type === 'template_expr' && currentMode.braceDepth === 0) {
        modeStack.pop();
        tokens.push({ type: 'punct', value: '}', line });
        i++;
        emitTemplateFrom(i);
        continue;
      }
      if (currentMode.braceDepth > 0) currentMode.braceDepth--;
      tokens.push({ type: 'punct', value: '}', line });
      i++;
      continue;
    }

    // 정규식 리터럴 /.../flags
    if (ch === '/') {
      const prev = tokens[tokens.length - 1] ?? null;
      if (canStartRegex(prev)) {
        const rx = matchRegexLiteral(content, i);
        if (rx) {
          blankRange(i, rx.endIdx);
          tokens.push({ type: 'regex', value: rx.raw, raw: rx.raw, line });
          i = rx.endIdx;
          continue;
        }
      }
    }

    // 숫자 리터럴
    if (DIGIT_RE.test(ch) || (ch === '.' && DIGIT_RE.test(content[i + 1] ?? ''))) {
      const slice = content.slice(i);
      const m = slice.match(
        /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:[eE][+-]?[0-9_]+)?)n?/,
      );
      if (m) {
        const raw = m[0];
        const cleaned = raw.replace(/n$/, '').replaceAll('_', '');
        const value = Number(cleaned);
        tokens.push({ type: 'number', raw, value, line });
        i += raw.length;
        continue;
      }
    }

    // 식별자 / 키워드
    if (IDENT_START_RE.test(ch)) {
      const start = i;
      i++;
      while (i < len && IDENT_PART_RE.test(content[i])) i++;
      const value = content.slice(start, i);
      tokens.push({ type: 'ident', value, line });
      continue;
    }

    // 다중 문자 구두점
    const three = content.slice(i, i + 3);
    if (three === '...' || three === '===' || three === '!==' || three === '>>>') {
      tokens.push({ type: 'punct', value: three, line });
      i += 3;
      continue;
    }
    const two = content.slice(i, i + 2);
    if (
      two === '?.' ||
      two === '=>' ||
      two === '++' ||
      two === '--' ||
      two === '==' ||
      two === '!=' ||
      two === '<=' ||
      two === '>=' ||
      two === '&&' ||
      two === '||' ||
      two === '??' ||
      two === '**' ||
      two === '<<' ||
      two === '>>'
    ) {
      tokens.push({ type: 'punct', value: two, line });
      i += 2;
      continue;
    }

    // 단항/후위 ! 구분 (TS non-null assertion `x!`)
    if (ch === '!') {
      const prev = tokens[tokens.length - 1];
      const isPostfixNonNull =
        prev !== undefined &&
        (prev.type === 'ident' ||
          prev.type === 'number' ||
          prev.type === 'string' ||
          prev.type === 'template' ||
          (prev.type === 'punct' && (prev.value === ')' || prev.value === ']')));
      tokens.push({ type: 'punct', value: '!', line, isPostfixNonNull });
      i++;
      continue;
    }

    // 유니코드 빼기 기호(−, U+2212)도 '-'로 정규화해 다룬다
    if (ch === '−') {
      tokens.push({ type: 'punct', value: '-', line });
      i++;
      continue;
    }

    tokens.push({ type: 'punct', value: ch, line });
    i++;
  }

  // throw 문 안쪽 토큰 표시
  markThrowTokens(tokens);

  return {
    tokens,
    strippedText: strippedChars.join(''),
  };
}

/**
 * `throw ...;` 문 안쪽에 놓인 토큰들에 `inThrow = true`를 표시한다.
 */
function markThrowTokens(tokens) {
  let inThrow = false;
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = tokens[i - 1];

    if (
      !inThrow &&
      tok.type === 'ident' &&
      tok.value === 'throw' &&
      !(prev?.type === 'punct' && (prev.value === '.' || prev.value === '?.'))
    ) {
      inThrow = true;
      depth = 0;
      tok.inThrow = true;
      continue;
    }

    if (inThrow) {
      if (tok.type === 'punct') {
        if (tok.value === '(' || tok.value === '[' || tok.value === '{' || tok.value === '${') {
          depth++;
        } else if (tok.value === ')' || tok.value === ']' || tok.value === '}') {
          if (depth > 0) {
            depth--;
          } else {
            inThrow = false;
            continue;
          }
        } else if (tok.value === ';' && depth === 0) {
          tok.inThrow = true;
          inThrow = false;
          continue;
        }
      }
      tok.inThrow = true;
    }
  }
}

/**
 * `{ a, type B, C as D }` 내부 토큰 목록이 모두 `type` 전용 지정자인지 확인한다.
 */
function areBraceSpecifiersTypeOnly(braceTokens) {
  const items = [];
  let current = [];
  for (const t of braceTokens) {
    if (t.type === 'punct' && t.value === ',') {
      if (current.length > 0) items.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) items.push(current);
  if (items.length === 0) return true;

  // 각 항목이 `type <식별자>`로 시작해야 타입 전용이다(`import { type } from 'zod'`는 값 import).
  return items.every(item => item.length >= 2 && item[0].type === 'ident' && item[0].value === 'type');
}

/**
 * 토큰 스트림에서 `import`, `export ... from`, `import()`, `require()` 모듈 경로와 `isTypeOnly`를 모두 뽑는다.
 */
export function extractModuleImports(tokens) {
  const imports = [];
  const n = tokens.length;

  for (let i = 0; i < n; i++) {
    const tok = tokens[i];
    const prev = tokens[i - 1];
    if (prev?.type === 'punct' && (prev.value === '.' || prev.value === '?.')) continue;

    // require('...')
    if (
      tok.type === 'ident' &&
      tok.value === 'require' &&
      tokens[i + 1]?.type === 'punct' &&
      tokens[i + 1]?.value === '(' &&
      tokens[i + 2]?.type === 'string'
    ) {
      imports.push({
        specifier: tokens[i + 2].value,
        line: tokens[i + 2].line,
        isTypeOnly: false,
        kind: 'require',
      });
      continue;
    }

    if (tok.type !== 'ident' || (tok.value !== 'import' && tok.value !== 'export')) continue;

    const keyword = tok.value;

    // 동적 import('...') 또는 TS type import('...')
    if (keyword === 'import' && tokens[i + 1]?.type === 'punct' && tokens[i + 1]?.value === '(') {
      const arg = tokens[i + 2];
      if (arg && (arg.type === 'string' || arg.type === 'template')) {
        const isTypeQuery =
          (prev?.type === 'ident' && (prev.value === 'type' || prev.value === 'typeof')) ||
          (prev?.type === 'punct' && (prev.value === ':' || prev.value === '<' || prev.value === '|'));
        imports.push({
          specifier: arg.value,
          line: arg.line,
          isTypeOnly: isTypeQuery,
          kind: 'dynamic-import',
        });
      }
      continue;
    }

    // 부수효과 import 'specifier'
    if (keyword === 'import' && tokens[i + 1]?.type === 'string') {
      imports.push({
        specifier: tokens[i + 1].value,
        line: tokens[i + 1].line,
        isTypeOnly: false,
        kind: 'import',
      });
      continue;
    }

    // 정적 import ... from 'specifier' / export ... from 'specifier'
    let cursor = i + 1;
    let hasTopLevelType = false;
    if (tokens[cursor]?.type === 'ident' && tokens[cursor]?.value === 'type') {
      // `import type from '...'`는 default import 이름이 `type`인 경우
      if (!(tokens[cursor + 1]?.type === 'ident' && tokens[cursor + 1]?.value === 'from')) {
        hasTopLevelType = true;
        cursor++;
      }
    }

    // `export type Foo = ...` 같은 타입 별칭 선언은 모듈 가져오기가 아님
    if (
      keyword === 'export' &&
      hasTopLevelType &&
      tokens[cursor]?.type === 'ident' &&
      tokens[cursor + 1]?.type === 'punct' &&
      (tokens[cursor + 1]?.value === '=' || tokens[cursor + 1]?.value === '<')
    ) {
      continue;
    }

    let hasDefaultOrNamespace = false;
    let braceTokens = null;
    let braceDepth = 0;
    let fromTokenIndex = -1;

    for (let j = cursor; j < n; j++) {
      const t = tokens[j];
      if (t.type === 'punct' && t.value === '{') {
        if (braceDepth === 0) braceTokens = [];
        else if (braceTokens) braceTokens.push(t);
        braceDepth++;
        continue;
      }
      if (t.type === 'punct' && t.value === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          if (
            tokens[j + 1]?.type === 'ident' &&
            tokens[j + 1]?.value === 'from' &&
            tokens[j + 2]?.type === 'string'
          ) {
            fromTokenIndex = j + 1;
          }
          break;
        }
        if (braceTokens) braceTokens.push(t);
        continue;
      }
      if (braceDepth > 0) {
        if (braceTokens) braceTokens.push(t);
        continue;
      }
      if (t.type === 'punct' && (t.value === ';' || t.value === '=')) break;
      if (t.type === 'ident' && STATEMENT_END_KEYWORDS.has(t.value)) break;
      if (t.type === 'ident' && t.value === 'from' && tokens[j + 1]?.type === 'string') {
        fromTokenIndex = j;
        break;
      }
      if (t.type === 'punct' && t.value === '*') {
        hasDefaultOrNamespace = true;
      } else if (t.type === 'ident' && t.value !== 'as') {
        hasDefaultOrNamespace = true;
      }
    }

    if (fromTokenIndex !== -1) {
      const specTok = tokens[fromTokenIndex + 1];
      let isTypeOnly = false;
      if (hasTopLevelType) {
        isTypeOnly = true;
      } else if (!hasDefaultOrNamespace && braceTokens !== null) {
        isTypeOnly = areBraceSpecifiersTypeOnly(braceTokens);
      }
      imports.push({
        specifier: specTok.value,
        line: specTok.line,
        isTypeOnly,
        kind: keyword,
      });
      i = fromTokenIndex + 1;
    }
  }

  return imports;
}

/**
 * 단항 음수 부호(`-`)가 붙은 경우를 합쳐서 코드 안 숫자 리터럴 목록을 뽑는다.
 */
export function extractNumericLiterals(tokens) {
  const numbers = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'number') continue;

    let raw = tok.raw;
    let value = tok.value;

    const prev = tokens[i - 1];
    if (prev?.type === 'punct' && prev.value === '-') {
      const beforeMinus = tokens[i - 2];
      const isBinaryMinus =
        beforeMinus !== undefined &&
        (beforeMinus.type === 'ident' ||
          beforeMinus.type === 'number' ||
          beforeMinus.type === 'string' ||
          beforeMinus.type === 'template' ||
          (beforeMinus.type === 'punct' &&
            (beforeMinus.value === ')' ||
              beforeMinus.value === ']' ||
              beforeMinus.value === '++' ||
              beforeMinus.value === '--' ||
              (beforeMinus.value === '!' && beforeMinus.isPostfixNonNull))));
      if (!isBinaryMinus) {
        raw = `-${raw}`;
        value = -value;
      }
    }

    if (Object.is(value, -0)) value = 0;
    numbers.push({ raw, value, line: tok.line });
  }

  return numbers;
}

/**
 * 파일 경로에서 소스를 읽어 토큰화 결과를 돌려준다.
 */
export function scanFile(filePath, content = fs.readFileSync(filePath, 'utf8')) {
  return tokenizeSource(content);
}
