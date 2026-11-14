import { config } from '@gallery/core/config';

/** 도슨트 움직임 조정값(PRD_V2 M4-7) — 값은 `config.ts` `NPC_MOTION`에서만 온다 */
export const docentTuning = () => config().NPC_MOTION;
