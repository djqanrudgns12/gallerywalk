import { isCliMain, REPO_ROOT, runCheckCli } from './common.mjs';
import { checkForbidden } from './forbidden.mjs';
import { checkLayers } from './layers.mjs';
import { checkNumbers } from './numbers.mjs';
import { checkVisual } from './visual.mjs';

/**
 * PLAN §14.1 정적 검사 규칙(①~⑤)과 ⑦ 그라데이션·순검정(HT-14)을 한 번에 실행한다.
 */
export function checkAll({ rootDir = REPO_ROOT } = {}) {
  const layers = checkLayers({ rootDir });
  const forbidden = checkForbidden({ rootDir });
  const numbers = checkNumbers({ rootDir });
  const visual = checkVisual({ rootDir });

  return {
    violations: [...layers.violations, ...forbidden.violations, ...visual.violations],
    warnings: [...layers.warnings, ...forbidden.warnings, ...numbers.warnings, ...visual.warnings],
  };
}

if (isCliMain(import.meta.url)) {
  runCheckCli(checkAll);
}
