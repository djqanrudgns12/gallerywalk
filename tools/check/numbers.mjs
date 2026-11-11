import path from 'node:path';
import { isCliMain, isTestFile, REPO_ROOT, runCheckCli, toPosixRelative, walkFiles } from './common.mjs';
import { extractNumericLiterals, scanFile } from './scanner.mjs';

const CODE_FILE_RE = /\.[cm]?[jt]sx?$/;
const ALLOWED_NUMBERS = new Set([0, 1, 2, -1]);

/**
 * ⑤ `packages/core/src/domain/{layout,pages}/**`의 숫자 리터럴(0·1·2·−1 제외, 시험 파일 제외)을
 * 경고 목록(`warnings`)으로 모은다(PLAN §14.1).
 */
export function checkNumbers({ rootDir = REPO_ROOT } = {}) {
  const warnings = [];
  const targetDirs = ['layout', 'pages'].map(sub => path.join(rootDir, 'packages/core/src/domain', sub));

  for (const dir of targetDirs) {
    const files = walkFiles(dir, {
      filter: filePath => CODE_FILE_RE.test(filePath) && !isTestFile(filePath),
    });

    for (const filePath of files) {
      const relFile = toPosixRelative(rootDir, filePath);
      const { tokens } = scanFile(filePath);
      const numbers = extractNumericLiterals(tokens);

      for (const num of numbers) {
        if (ALLOWED_NUMBERS.has(num.value)) continue;
        warnings.push({
          file: relFile,
          line: num.line,
          rule: 'domain-magic-number',
          value: num.value,
          raw: num.raw,
          message: `domain/{layout,pages}/ 안의 숫자 리터럴 경고 (${num.raw})`,
        });
      }
    }
  }

  return { violations: [], warnings };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkNumbers);
}
