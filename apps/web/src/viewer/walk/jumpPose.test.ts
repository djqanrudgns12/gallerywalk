import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { JUMP_IDLE, jumpBody, jumpBusy, type JumpState, jumpStart, stepJump } from './jumpPose.ts';

const q = () => config().CHAR_JUMP_SQUASH;

describe('점프 몸 상태 기계(W-05)', () => {
  it('웅크림 → 도약 → 공중(내려앉을 때까지) → 착지 눌림 → 되튐 → 쉼, 단계 시간은 CHAR_JUMP_SQUASH', () => {
    let s: JumpState = jumpStart();
    expect(s.phase).toBe('crouch');
    s = stepJump(s, q().crouchSec * 0.99, false);
    expect(s.phase).toBe('crouch');
    s = stepJump(s, q().crouchSec * 0.02, false);
    expect(s.phase).toBe('launch');
    s = stepJump(s, q().launchSec, false);
    expect(s.phase).toBe('air');
    // 공중은 시간이 아무리 지나도 내려앉기 전까지
    s = stepJump(s, 10, false);
    expect(s.phase).toBe('air');
    s = stepJump(s, 1 / 60, true);
    expect(s).toEqual({ phase: 'land', t: 0 });
    s = stepJump(s, q().landSec * 0.99, false);
    expect(s.phase).toBe('land');
    s = stepJump(s, q().landSec * 0.02, false);
    expect(s.phase).toBe('rebound');
    s = stepJump(s, q().reboundSec, false);
    expect(s).toBe(JUMP_IDLE);
    expect(stepJump(JUMP_IDLE, 1, false)).toBe(JUMP_IDLE);
  });

  it('한 조각이 단계보다 길면 넘친 시간을 다음 단계로 넘긴다(저속 기기)', () => {
    const s = stepJump(jumpStart(), q().crouchSec + q().launchSec * 0.5, false);
    expect(s.phase).toBe('launch');
    expect(s.t).toBeCloseTo(q().launchSec * 0.5, 9);
  });

  it('다시 뛸 수 없는 단계는 웅크림·도약·공중뿐(착지 눌림·되튐 중에는 다시 뛸 수 있음)', () => {
    expect(jumpBusy(jumpStart())).toBe(true);
    expect(jumpBusy({ phase: 'launch', t: 0 })).toBe(true);
    expect(jumpBusy({ phase: 'air', t: 0 })).toBe(true);
    expect(jumpBusy({ phase: 'land', t: 0 })).toBe(false);
    expect(jumpBusy({ phase: 'rebound', t: 0 })).toBe(false);
    expect(jumpBusy(JUMP_IDLE)).toBe(false);
  });

  it('몸 배율: 웅크림 끝 = crouchY·crouchXZ, 도약 가운데 = launchY, 공중은 제 모양 + 공중 자세, 착지 끝 = landY, 되튐은 1로', () => {
    const c = q();
    const crouchEnd = jumpBody({ phase: 'crouch', t: c.crouchSec });
    expect(crouchEnd.sy).toBeCloseTo(c.crouchY, 9);
    expect(crouchEnd.sxz).toBeCloseTo(c.crouchXZ, 9);
    expect(crouchEnd.tuck).toBe(0);
    const launchMid = jumpBody({ phase: 'launch', t: c.launchSec / 2 });
    expect(launchMid.sy).toBeCloseTo(c.launchY, 9);
    expect(launchMid.sxz).toBeCloseTo(c.launchXZ, 9);
    expect(jumpBody({ phase: 'launch', t: c.launchSec }).sy).toBeCloseTo(1, 9);
    expect(jumpBody({ phase: 'air', t: 0.2 })).toEqual({ sy: 1, sxz: 1, tuck: 1 });
    const landEnd = jumpBody({ phase: 'land', t: c.landSec });
    expect(landEnd.sy).toBeCloseTo(c.landY, 9);
    expect(landEnd.sxz).toBeCloseTo(c.landXZ, 9);
    expect(landEnd.tuck).toBeCloseTo(0, 9);
    expect(jumpBody({ phase: 'rebound', t: 0 }).sy).toBeCloseTo(c.landY, 9);
    expect(jumpBody({ phase: 'rebound', t: c.reboundSec }).sy).toBeCloseTo(1, 9);
    // 되튐 뒤쪽에서 한 번 살짝 넘친다(키가 1보다 조금 큼)
    expect(jumpBody({ phase: 'rebound', t: c.reboundSec * 0.7 }).sy).toBeGreaterThan(1);
    expect(jumpBody(JUMP_IDLE)).toEqual({ sy: 1, sxz: 1, tuck: 0 });
  });

  it('동작 줄이기: 눌림·늘림은 끄고(배율 1) 공중 자세는 그대로', () => {
    const c = q();
    expect(jumpBody({ phase: 'crouch', t: c.crouchSec }, true)).toEqual({ sy: 1, sxz: 1, tuck: 0 });
    expect(jumpBody({ phase: 'land', t: c.landSec / 2 }, true).sy).toBe(1);
    expect(jumpBody({ phase: 'air', t: 0 }, true).tuck).toBe(1);
  });
});
