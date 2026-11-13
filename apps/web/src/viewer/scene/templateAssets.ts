import type { TemplateId } from '@gallery/core/templates';
import { z } from 'zod';
import coreV4Url from '../../tpl/modern-history/core-v4.glb?url';
import coreUrl from '../../tpl/modern-history/core.glb?url';
import exteriorV4Url from '../../tpl/modern-history/exterior-v4.glb?url';
import exteriorUrl from '../../tpl/modern-history/exterior.glb?url';
import fixturesUrl from '../../tpl/modern-history/fixtures.glb?url';
import hallV4Url from '../../tpl/modern-history/hall-v4.glb?url';
import { fixtures as mhFixtures } from '../../tpl/modern-history/manifest.json';
import { SIGN_KINDS, type SignKind, type TextArea } from '../signs/signs.ts';

/**
 * 템플릿마다 3D 조각 파일(예산 검사를 통과한 `src/tpl/` 것만, AGENTS.md §4).
 * 외관 조각을 먼저 — 광장에서 시작하므로 — 그다음 실내 조각(계단을 오르는 동안 받음, §2.5).
 */
export interface TemplateAssets {
  readonly modules: readonly string[];
  /**
   * 공간 v4(스키마 3, ADR-071) 조각: 외관 → 홀 → 전시실 순(광장부터 보이게). 높이와 상관없는 바닥·광장 판은 v3 묶음에 있어
   * v3 외관·실내 묶음도 함께 받는다(v4 묶음에 그 판이 들어오면 빼서 첫 화면 바이트를 줄인다)
   */
  readonly modulesV4: readonly string[];
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
    modulesV4: [exteriorV4Url, exteriorUrl, hallV4Url, coreUrl, coreV4Url],
    fixtures: fixturesUrl,
    signAreas: areasOf(mhFixtures.models),
  },
};

/** 배치 모양 판에 맞는 조각 묶음(스키마 3 = 공간 v4) */
export const modulesFor = (assets: TemplateAssets, schemaVersion: number): readonly string[] =>
  schemaVersion === 3 ? assets.modulesV4 : assets.modules;
