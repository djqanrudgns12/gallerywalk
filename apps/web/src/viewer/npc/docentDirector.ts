import type { Layout } from '@gallery/core/types';
import {
  DocentBrain,
  type DocentMe,
  type DocentOutput,
  type DocentSpot,
  docentLines,
  type Speech,
} from './docentBrain.ts';
import type { Rng } from './shuffleBag.ts';

/**
 * 도슨트 여럿을 묶는다(PRD_V2 W-10): 자리마다 행동 하나(`DocentBrain`, 자리마다 섞은 주머니 하나), 그리는 도슨트만 나를 보고 말한다.
 * 말걸기 대사는 한 번에 하나. 순수(시각·난수 주입) — 3D 쪽(`Docents.tsx`)은 이 결과를 뼈·말풍선·저장소에 옮기기만 한다.
 */

export interface DocentSpotFull extends DocentSpot {
  /** 배치 구역 ID(plaza·hall·관 ID) */
  readonly zone: string;
  /** 바닥 높이 */
  readonly y: number;
}

/** 배치의 도슨트 자리. 스키마 3(공간 v4)에서만 있고, 스키마 2면 빈 목록 */
export const docentSpotsOf = (layout: Layout): readonly DocentSpotFull[] =>
  layout.schemaVersion === 3
    ? (layout.npcSpots ?? []).map(s => ({
        id: s.id,
        zone: s.zone,
        pos: [s.pos[0], s.pos[2]] as const,
        y: s.pos[1],
        yaw: s.yaw,
      }))
    : [];

export interface DirectorInput {
  readonly now: number;
  readonly me: DocentMe | null;
  readonly walking: boolean;
  readonly calm: boolean;
}

export interface SpeechOf {
  readonly npcId: string;
  readonly speech: Speech;
}

export interface DirectorFrame {
  readonly outs: ReadonlyMap<string, DocentOutput>;
  /** 그리는 도슨트 중 스스로 다음 프레임이 필요한 것이 있는가 */
  readonly busy: boolean;
  /** 다음에 한 번 깨울 시각(초). 없으면 null */
  readonly wakeAt: number | null;
  /** 머리 위에 띄울 대사 하나: 말걸기 먼저, 그다음 가까운 도슨트의 한마디 */
  readonly bubble: SpeechOf | null;
  /** 말걸기 대사(대사 카드) */
  readonly talk: SpeechOf | null;
}

export class DocentDirector {
  readonly spots: readonly DocentSpotFull[];
  private readonly brains = new Map<string, DocentBrain>();
  private drawn: ReadonlySet<string> = new Set();
  private last: DirectorInput | null = null;

  constructor(spots: readonly DocentSpotFull[], rng: Rng = Math.random) {
    this.spots = spots;
    for (const s of spots) this.brains.set(s.id, new DocentBrain(s, docentLines(s.id), rng));
  }

  /** 지금 그리는 도슨트(`drawnDocentIds`) */
  setDrawn(ids: ReadonlySet<string>): void {
    this.drawn = ids;
  }

  isDrawn(id: string): boolean {
    return this.drawn.has(id);
  }

  /** 말걸기(행동 키). 그리는 도슨트만 받는다. 다른 도슨트의 말걸기 대사는 닫는다 */
  talk(npcId: string, now: number): Speech | null {
    const brain = this.brains.get(npcId);
    if (!brain || !this.drawn.has(npcId)) return null;
    for (const [id, b] of this.brains) if (id !== npcId) b.closeTalk();
    return brain.talk(now, this.last?.calm ?? false);
  }

  /** 말걸기 대사를 닫는다(카드의 닫기). id가 없으면 모두 */
  closeTalk(npcId?: string): void {
    for (const [id, b] of this.brains) if (npcId === undefined || id === npcId) b.closeTalk();
  }

  step(input: DirectorInput): DirectorFrame {
    this.last = input;
    const outs = new Map<string, DocentOutput>();
    let busy = false;
    let wakeAt: number | null = null;
    let talk: SpeechOf | null = null;
    let tip: (SpeechOf & { readonly d: number }) | null = null;
    for (const [id, brain] of this.brains) {
      const drawn = this.drawn.has(id);
      // 그리지 않는 도슨트는 아무도 없는 것으로(나를 보지 않고 말하지 않음)
      const out = brain.update({ ...input, me: drawn ? input.me : null });
      outs.set(id, out);
      if (!drawn) continue;
      busy ||= out.busy;
      if (out.wakeAt !== null && (wakeAt === null || out.wakeAt < wakeAt)) wakeAt = out.wakeAt;
      if (out.talk) talk = { npcId: id, speech: out.talk };
      else if (out.speech && (!tip || out.distance < tip.d))
        tip = { npcId: id, speech: out.speech, d: out.distance };
    }
    const bubble = talk ?? (tip ? { npcId: tip.npcId, speech: tip.speech } : null);
    return { outs, busy, wakeAt, bubble, talk };
  }
}
