import { config } from '@gallery/core/config';
import type { Exterior } from '@gallery/core/types';

/**
 * 행동 키(Space·터치 행동 단추, PRD_V2 W-01): 지금 누르면 무엇을 할지. 순수 함수.
 * 우선순위 ① 도슨트가 `NPC_TALK_RADIUS_M` 안이고 내 앞쪽 `NPC_TALK_ARC_DEG` 안 → 말걸기
 * ② 대문이 `GATE_RADIUS_M` 안 → 나가기 ③ 그 밖 → 점프.
 */

export type WalkAction = 'jump' | 'talk' | 'exit';

export interface ActionNpc {
  readonly id: string;
  /** 바닥 자리(x, z) */
  readonly pos: readonly [number, number];
  /** 바라보는 방향(rad, 0 = +Z) */
  readonly yaw: number;
}

export interface ActionMe {
  readonly x: number;
  readonly z: number;
  /** 몸이 바라보는 방향(rad, 0 = +Z) */
  readonly yaw: number;
}

export interface ResolvedAction {
  readonly action: WalkAction;
  /** 말걸기일 때 그 도슨트 */
  readonly npcId: string | null;
}

const JUMP: ResolvedAction = { action: 'jump', npcId: null };
const EXIT: ResolvedAction = { action: 'exit', npcId: null };

export const resolveAction = (
  me: ActionMe,
  npcs: readonly ActionNpc[],
  gate: readonly [number, number] | null,
): ResolvedAction => {
  const c = config();
  // 앞쪽 부채꼴의 반각: 내 앞 방향과 도슨트 쪽 방향의 사잇각이 이보다 작으면(코사인이 크면) 앞쪽
  const halfArcCos = Math.cos(((c.NPC_TALK_ARC_DEG / 2) * Math.PI) / 180);
  const fx = Math.sin(me.yaw);
  const fz = Math.cos(me.yaw);
  let best: ActionNpc | null = null;
  let bestD = c.NPC_TALK_RADIUS_M;
  for (const n of npcs) {
    const dx = n.pos[0] - me.x;
    const dz = n.pos[1] - me.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    // 거의 같은 자리면 방향을 따지지 않는다(몸이 겹칠 만큼 가까움)
    const ahead = d < 1e-6 || (fx * dx + fz * dz) / d >= halfArcCos;
    if (!ahead) continue;
    best = n;
    bestD = d;
  }
  if (best) return { action: 'talk', npcId: best.id };
  if (gate && Math.hypot(gate[0] - me.x, gate[1] - me.z) <= c.GATE_RADIUS_M) return EXIT;
  return JUMP;
};

/**
 * 대문 자리: 배치가 낸 `gate`(스키마 3, 공간 v4)가 있으면 그것, 없으면(스키마 2) 광장 바닥 중 정면(`facadeZ`)에서
 * 먼 쪽 끝의 가운데(x = 0).
 */
export const gateOf = (
  exterior: Exterior,
  gate?: { readonly pos: readonly [number, number, number] } | undefined,
): readonly [number, number] => {
  if (gate) return [gate.pos[0], gate.pos[2]];
  const { min, max } = exterior.plaza;
  const far = Math.abs(min[1] - exterior.facadeZ) >= Math.abs(max[1] - exterior.facadeZ) ? min[1] : max[1];
  return [0, far];
};
