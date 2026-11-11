import { isCliMain, REPO_ROOT, runCheckCli } from './common.mjs';
import { checkForbidden } from './forbidden.mjs';
import { checkLayers } from './layers.mjs';
import { checkNumbers } from './numbers.mjs';

/**
 * PLAN §14.1 정적 검사 규칙(①~⑤)을 한 번에 실행한다.
 */
export function checkAll({ rootDir = REPO_ROOT } = {}) {
  const layers = checkLayers({ rootDir });
  const forbidden = checkForbidden({ rootDir });
  const numbers = checkNumbers({ rootDir });

  return {
    violations: [...layers.violations, ...forbidden.violations],
    warnings: [...layers.warnings, ...forbidden.warnings, ...numbers.warnings],
  };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkAll);
}
