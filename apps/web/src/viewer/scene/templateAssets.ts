import type { TemplateId } from '@gallery/core/templates';
import { z } from 'zod';
import coreUrl from '../../tpl/modern-history/core.glb?url';
import exteriorUrl from '../../tpl/modern-history/exterior.glb?url';
import fixturesUrl from '../../tpl/modern-history/fixtures.glb?url';
import { fixtures as mhFixtures } from '../../tpl/modern-history/manifest.json';
import { SIGN_KINDS, type SignKind, type TextArea } from '../signs/signs.ts';

/**
 * 템플릿마다 3D 조각 파일(예산 검사를 통과한 `src/tpl/` 것만, AGENTS.md §4).
 * 외관 조각을 먼저 — 광장에서 시작하므로 — 그다음 실내 조각(계단을 오르는 동안 받음, §2.5).
 */
export interface TemplateAssets {
  readonly modules: readonly string[];
  readonly fixtures: string;
  /** 사인 설비의 글자 자리(굽기 도구가 manifest에 적은 것, V-03) */
  readonly signAreas: Readonly<Partial<Record<SignKind, TextArea>>>;
}

const TextAreaSchema = z.object({ w: z.number().positive(), h: z.number().positive(), z: z.number() });

/** manifest(바깥 파일)에서 사인 글자 자리만 꺼낸다 — 모양이 틀리면 그 종류는 글 없이 */
const areasOf = (models: Record<string, unknown>): Partial<Record<SignKind, TextArea>> => {
  const out: Partial<Record<SignKind, TextArea>> = {};
  for (const k of SIGN_KINDS) {
    const m = models[k];
    const parsed = TextAreaSchema.safeParse(
      typeof m === 'object' && m !== null && 'textArea' in m ? m.textArea : undefined,
    );
    if (parsed.success) out[k] = parsed.data;
  }
  return out;
};

export const templateAssets: Readonly<Record<TemplateId, TemplateAssets>> = {
  'modern-history': {
    modules: [exteriorUrl, coreUrl],
    fixtures: fixturesUrl,
    signAreas: areasOf(mhFixtures.models),
  },
};
