import { config } from '@gallery/core/config';

/**
 * 관람 예절 알림(놀이, ADR-057 보충): 실내에서 오래 뛰거나 짧은 시간에 여러 번 뛰어오르면 도슨트 말풍선으로 알린다.
 * 순수 상태 기계 — 걷기 화면이 매 프레임 `step`을 부르고, 알림이 나오면 말풍선을 띄우고 뛰기를 잠깐 잠근다(`run`·`jump`만).
 * 광장(바깥)에서는 뛰기·뛰어오르기를 세지 않는다. 같은 알림은 `MANNER_COOLDOWN_SEC` 안에 다시 하지 않는다.
 *
 * 같은 말풍선으로 알리는 일(PRD_V2 W-06·W-07): 광장 경계에 닿음(`boundary`, `BOUNDARY_TOAST_SEC`에 한 번)·
 * 사람끼리 부딪힘(`bump`, `CROWD_TOAST_SEC`에 한 번). 이 둘은 광장에서도 알린다. 한 프레임에 여럿이면 부딪힘 → 경계 → 예절 차례.
 */

export type MannerNotice = 'run' | 'jump' | 'boundary' | 'bump';

export interface MannerInput {
  /** 실내(정문 안)인가 */
  readonly indoor: boolean;
  /** 지금 뛰는 빠르기로 움직이는가 */
  readonly running: boolean;
  /** 이 프레임에 뛰어올랐는가 */
  readonly jumped: boolean;
  /** 이 프레임에 사람과 부딪혔는가 */
  readonly bumped?: boolean | undefined;
  /** 이 프레임에 광장 경계에 닿았는가 */
  readonly boundary?: boolean | undefined;
}

export class MannerWatch {
  private clock = 0;
  private runSec = 0;
  private jumps: number[] = [];
  private readonly lastAt: Record<MannerNotice, number> = {
    run: -Infinity,
    jump: -Infinity,
    boundary: -Infinity,
    bump: -Infinity,
  };

  step(dt: number, input: MannerInput): MannerNotice | null {
    const c = config();
    this.clock += dt;
    const since = (n: MannerNotice): number => this.clock - this.lastAt[n];
    if (input.bumped && since('bump') >= c.CROWD_TOAST_SEC) {
      this.lastAt.bump = this.clock;
      return 'bump';
    }
    if (input.boundary && since('boundary') >= c.BOUNDARY_TOAST_SEC) {
      this.lastAt.boundary = this.clock;
      return 'boundary';
    }
    if (!input.indoor) {
      this.runSec = 0;
      this.jumps = [];
      return null;
    }
    this.runSec = input.running ? this.runSec + dt : 0;
    if (input.jumped) this.jumps.push(this.clock);
    this.jumps = this.jumps.filter(t => this.clock - t <= c.MANNER_JUMP_WINDOW_SEC);

    const ready = (n: MannerNotice): boolean => since(n) >= c.MANNER_COOLDOWN_SEC;
    if (this.runSec >= c.MANNER_RUN_SEC && ready('run')) {
      this.lastAt.run = this.clock;
      this.runSec = 0;
      return 'run';
    }
    if (this.jumps.length >= c.MANNER_JUMP_COUNT && ready('jump')) {
      this.lastAt.jump = this.clock;
      this.jumps = [];
      return 'jump';
    }
    return null;
  }
}
