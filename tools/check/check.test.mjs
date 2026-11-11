import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatViolation, formatWarning, REPO_ROOT } from './common.mjs';
import { checkForbidden } from './forbidden.mjs';
import { checkAll } from './index.mjs';
import { checkLayers } from './layers.mjs';
import { checkNumbers } from './numbers.mjs';

const CHECK_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(CHECK_DIR, 'fixtures');
const VIOLATION_LINE_RE = /^[^\s:]+:\d+ {2}[a-z0-9-]+ {2}.+$/;
const WARNING_LINE_RE = /^[^\s:]+:\d+ {2}\[warn\] [a-z0-9-]+ {2}.+$/;

function runCli(scriptName, rootDir, extraArgs = []) {
  const scriptPath = path.join(CHECK_DIR, scriptName);
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, '--root', rootDir, ...extraArgs], {
      encoding: 'utf8',
    });
    return { code: 0, stdout: stdout.trim() };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: String(err.stdout ?? '').trim(),
    };
  }
}

describe('P1-2 정적 검사 도구 (PLAN §14.1)', () => {
  describe('③ layers.mjs — 층 위반 검사', () => {
    it('일부러 어긴 견본(fixtures/layers/bad)에서 ui/viewer/screens → adapters 및 domain → 외부·zod 값·DOM·Node API 위반을 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'layers/bad');
      const { violations } = checkLayers({ rootDir: badRoot });
      const rules = violations.map(v => v.rule);

      assert.equal(rules.filter(r => r === 'ui-no-adapters').length, 3);
      assert.equal(rules.filter(r => r === 'domain-no-external').length, 3);
      assert.equal(rules.filter(r => r === 'domain-no-dom-node').length, 3);

      for (const v of violations) {
        assert.match(formatViolation(v), VIOLATION_LINE_RE);
      }

      const cli = runCli('layers.mjs', badRoot);
      assert.equal(cli.code, 1);
      assert.equal(cli.stdout.split('\n').length, violations.length);
    });

    it('통과 견본(fixtures/layers/good, zod import type 및 domain/*.test.ts의 node:crypto 예외 포함)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'layers/good');
      const { violations } = checkLayers({ rootDir: goodRoot });
      assert.deepEqual(violations, []);

      const cli = runCli('layers.mjs', goodRoot);
      assert.equal(cli.code, 0);
    });

    it('지금 저장소에서 통과한다', () => {
      const { violations } = checkLayers({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });

  describe('①·②·④ forbidden.mjs — 화면 한국어·CSS hex 색·금지 요소 검사', () => {
    it('일부러 어긴 견본(fixtures/forbidden/bad)에서 한국어 문자열·CSS hex 색·<select>·backdrop-filter·이모지를 모두 잡는다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'forbidden/bad');
      const { violations } = checkForbidden({ rootDir: badRoot });
      const ruleSet = new Set(violations.map(v => v.rule));

      assert.ok(ruleSet.has('no-inline-korean'));
      assert.ok(ruleSet.has('no-css-hex-color'));
      assert.ok(ruleSet.has('no-native-select'));
      assert.ok(ruleSet.has('no-backdrop-filter'));
      assert.ok(ruleSet.has('no-emoji'));

      for (const v of violations) {
        assert.match(formatViolation(v), VIOLATION_LINE_RE);
      }

      const cli = runCli('forbidden.mjs', badRoot);
      assert.equal(cli.code, 1);
    });

    it('통과 견본(fixtures/forbidden/good, 주석·tokens.css·themes/*.css·apps/web/dev/** 예외 포함)에서 통과한다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'forbidden/good');
      const { violations } = checkForbidden({ rootDir: goodRoot });
      assert.deepEqual(violations, []);

      const cli = runCli('forbidden.mjs', goodRoot);
      assert.equal(cli.code, 0);
    });

    it('지금 저장소에서 통과한다', () => {
      const { violations } = checkForbidden({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
    });
  });

  describe('⑤ numbers.mjs — domain/{layout,pages}/ 숫자 리터럴 경고 목록', () => {
    it('일부러 넣은 견본(fixtures/numbers/bad)에서 0·1·2·-1 밖의 숫자 리터럴을 경고 목록으로 모으고 종료 코드는 0이다', () => {
      const badRoot = path.join(FIXTURES_DIR, 'numbers/bad');
      const { violations, warnings } = checkNumbers({ rootDir: badRoot });

      assert.deepEqual(violations, []);
      assert.equal(warnings.length, 5);
      assert.deepEqual(
        warnings.map(w => w.raw),
        ['0.8', '16', '-2', '0.05', '18'],
      );

      for (const w of warnings) {
        assert.match(formatWarning(w), WARNING_LINE_RE);
      }

      const cli = runCli('numbers.mjs', badRoot, ['--warnings']);
      assert.equal(cli.code, 0);
      assert.equal(cli.stdout.split('\n').length, 5);
    });

    it('통과 견본(fixtures/numbers/good, 0·1·2·-1 및 시험 파일 예외 포함)에서 경고가 0건이다', () => {
      const goodRoot = path.join(FIXTURES_DIR, 'numbers/good');
      const { violations, warnings } = checkNumbers({ rootDir: goodRoot });
      assert.deepEqual(violations, []);
      assert.deepEqual(warnings, []);
    });
  });

  describe('index.mjs — 통합 실행', () => {
    it('지금 저장소에서 checkAll이 위반 0건으로 통과한다', () => {
      const { violations, warnings } = checkAll({ rootDir: REPO_ROOT });
      assert.deepEqual(violations, []);
      assert.ok(Array.isArray(warnings));

      const cli = runCli('index.mjs', REPO_ROOT);
      assert.equal(cli.code, 0);
    });
  });
});
