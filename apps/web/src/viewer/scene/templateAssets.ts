import type { TemplateId } from '@gallery/core/templates';
import coreUrl from '../../tpl/modern-history/core.glb?url';
import exteriorUrl from '../../tpl/modern-history/exterior.glb?url';
import fixturesUrl from '../../tpl/modern-history/fixtures.glb?url';

/**
 * 템플릿마다 3D 조각 파일(예산 검사를 통과한 `src/tpl/` 것만, AGENTS.md §4).
 * 외관 조각을 먼저 — 광장에서 시작하므로 — 그다음 실내 조각(계단을 오르는 동안 받음, §2.5).
 */
export interface TemplateAssets {
  readonly modules: readonly string[];
  readonly fixtures: string;
}

export const templateAssets: Readonly<Record<TemplateId, TemplateAssets>> = {
  'modern-history': { modules: [exteriorUrl, coreUrl], fixtures: fixturesUrl },
};
