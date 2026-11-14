import { config } from '@gallery/core/config';

/**
 * 내 점프 몸 연출(PRD_V2 W-05, 클립 없이 엔진이): 웅크림 → 도약 늘림 → 공중 자세 → 착지 눌림 → 되튐.
 * three에 기대지 않는 순수 상태 기계 — 걷기 엔진(`Walker`)이 조각마다 `stepJump`를 부르고, 걷기 화면이
 * `jumpBody`로 몸 배율(키 Y·폭 XZ)과 공중 자세 가중을 얻어 캐릭터 뿌리에 준다.
 *
 * - 웅크림 동안은 땅에 있다(몸만 눌림). 웅크림이 끝나는 순간 걷기 엔진이 지금 포물선대로 뜬다(높이·체공 그대로).
 * - 공중 단계는 내려앉을 때(`landed`)까지 이어진다. 단계 시간·배율은 `CHAR_JUMP_SQUASH`.
 * - 동작 줄이기면 눌림·늘림을 끈다(공중 자세는 몸 모양이 아니라 그대로 둔다).
 */

export type JumpPhase = 'idle' | 'crouch' | 'launch' | 'air' | 'land' | 'rebound';

export interface JumpState {
  readonly phase: JumpPhase;
  /** 이 단계에 들어선 뒤 지난 시간(s) */
  readonly t: number;
}

export interface JumpBody {
  /** 키 배율 */
  readonly sy: number;
  /** 폭 배율 */
  readonly sxz: number;
  /** 공중 자세 가중 0..1(무릎 접기·팔 벌림, 걷던 다리 멈춤) */
  readonly tuck: number;
}

/** 착지 먼지 신호: `n`이 바뀌면 그 자리(x, y, z)에서 한 번(`JumpDust`) */
export interface DustCue {
  n: number;
  x: number;
  y: number;
  z: number;
}

/**
 * 내 캐릭터 몸 연출 자료(W-05·W-07): 걷기 화면이 매 프레임 채우고 `Character`가 읽는다(손잡이 `pose`와 반대 방향).
 * 몸 배율은 뿌리 그룹 scale(발 기준점이 바닥이라 눌려도 발은 땅에 붙음).
 */
export interface CharacterFx {
  /** 점프 키 배율 · 폭 배율 · 공중 자세 가중 0..1(`jumpBody`) */
  sy: number;
  sxz: number;
  tuck: number;
  /** 부딪힘 몸 연출 세기(벽 1, 사람은 약하게) */
  bumpGain: number;
  readonly dust: DustCue;
}

export const characterFx = (): CharacterFx => ({
  sy: 1,
  sxz: 1,
  tuck: 0,
  bumpGain: 1,
  dust: { n: 0, x: 0, y: 0, z: 0 },
});

export const JUMP_IDLE: JumpState = { phase: 'idle', t: 0 };
const FLAT: JumpBody = { sy: 1, sxz: 1, tuck: 0 };

/** 누름 → 웅크림부터 */
export const jumpStart = (): JumpState => ({ phase: 'crouch', t: 0 });

/** 아직 뛰는 중이라 다시 뛸 수 없는가(웅크림·도약·공중). 착지 눌림·되튐 중에는 다시 뛸 수 있다 */
export const jumpBusy = (s: JumpState): boolean =>
  s.phase === 'crouch' || s.phase === 'launch' || s.phase === 'air';

const durationOf = (phase: JumpPhase): number => {
  const q = config().CHAR_JUMP_SQUASH;
  switch (phase) {
    case 'crouch':
      return q.crouchSec;
    case 'launch':
      return q.launchSec;
    case 'land':
      return q.landSec;
    case 'rebound':
      return q.reboundSec;
    default:
      // 공중은 내려앉을 때까지, 쉼은 끝이 없음
      return Number.POSITIVE_INFINITY;
  }
};

const nextOf = (phase: JumpPhase): JumpPhase => {
  switch (phase) {
    case 'crouch':
      return 'launch';
    case 'launch':
      return 'air';
    case 'land':
      return 'rebound';
    default:
      return 'idle';
  }
};

/**
 * 한 조각 진행. `landed` = 이 조각에 바닥에 내려앉았는가(그러면 착지 눌림부터).
 * 한 조각이 단계보다 길면 넘친 시간을 다음 단계로 넘긴다(저속 기기에서도 단계 시간이 같게).
 */
export const stepJump = (s: JumpState, dt: number, landed: boolean): JumpState => {
  if (landed) return { phase: 'land', t: 0 };
  if (s.phase === 'idle') return s;
  let phase: JumpPhase = s.phase;
  let t = s.t + Math.max(0, dt);
  for (;;) {
    const d = durationOf(phase);
    if (t < d) return { phase, t };
    t -= d;
    phase = nextOf(phase);
    if (phase === 'idle') return JUMP_IDLE;
  }
};

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const easeOut = (x: number): number => {
  const u = Math.min(1, Math.max(0, x));
  return 1 - (1 - u) * (1 - u);
};

/** 지금 단계의 몸 모양. `reduced`(동작 줄이기)면 배율은 1 그대로 */
export const jumpBody = (s: JumpState, reduced = false): JumpBody => {
  if (s.phase === 'idle') return FLAT;
  const q = config().CHAR_JUMP_SQUASH;
  const u = Math.min(1, s.t / durationOf(s.phase));
  let sy = 1;
  let sxz = 1;
  let tuck = 0;
  switch (s.phase) {
    case 'crouch': {
      // 땅에서 몸만 눌린다
      const e = smooth(u);
      sy = lerp(1, q.crouchY, e);
      sxz = lerp(1, q.crouchXZ, e);
      break;
    }
    case 'launch': {
      // 앞 절반: 웅크림 → 늘림, 뒤 절반: 늘림 → 제 모양. 공중 자세는 이 동안 들어온다
      if (u < 0.5) {
        const e = smooth(u * 2);
        sy = lerp(q.crouchY, q.launchY, e);
        sxz = lerp(q.crouchXZ, q.launchXZ, e);
      } else {
        const e = smooth(u * 2 - 1);
        sy = lerp(q.launchY, 1, e);
        sxz = lerp(q.launchXZ, 1, e);
      }
      tuck = smooth(u);
      break;
    }
    case 'air':
      tuck = 1;
      break;
    case 'land': {
      // 닿자마자 빨리 눌리고, 공중 자세는 풀린다
      const e = easeOut(u);
      sy = lerp(1, q.landY, e);
      sxz = lerp(1, q.landXZ, e);
      tuck = 1 - u;
      break;
    }
    case 'rebound': {
      // 눌림에서 제 모양으로, 한 번 살짝 넘쳤다 돌아온다((1−u)·cos πu: 1 → 0 → 작은 음수 → 0)
      const w = (1 - u) * Math.cos(Math.PI * u);
      sy = 1 + (q.landY - 1) * w;
      sxz = 1 + (q.landXZ - 1) * w;
      break;
    }
  }
  return reduced ? { sy: 1, sxz: 1, tuck } : { sy, sxz, tuck };
};

/**
 * 캐릭터 몸의 부딪힘 연출 세기(W-07): 벽 부딪힘이 있으면 그것, 없으면 사람 부딪힘(약하게는 `bumpGain`이 맡음).
 * 동작 줄이기(PRD 8.4)면 0 — 몸이 눌렸다 튀는 작은 움직임을 끈다(멈칫하는 걸음은 걷기 엔진이 그대로 한다).
 */
export const bumpBody = (bump: number, crowdBump: number, reduced: boolean): number =>
  reduced ? 0 : bump > 0 ? bump : crowdBump;
