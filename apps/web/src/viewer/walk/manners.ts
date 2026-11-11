import { config } from '@gallery/core/config';

/**
 * 관람 예절 알림(놀이, ADR-057 보충): 실내에서 오래 뛰거나 짧은 시간에 여러 번 뛰어오르면 도슨트 말풍선으로 알린다.
 * 순수 상태 기계 — 걷기 화면이 매 프레임 `step`을 부르고, 알림이 나오면 말풍선을 띄우고 뛰기를 잠깐 잠근다.
 * 광장(바깥)에서는 세지 않는다. 같은 알림은 `MANNER_COOLDOWN_SEC` 안에 다시 하지 않는다.
 */

export type MannerNotice = 'run' | 'jump';

export interface MannerInput {
  /** 실내(정문 안)인가 */
  readonly indoor: boolean;
  /** 지금 뛰는 빠르기로 움직이는가 */
  readonly running: boolean;
  /** 이 프레임에 뛰어올랐는가 */
  readonly jumped: boolean;
}

export class MannerWatch {
  private clock = 0;
  private runSec = 0;
  private jumps: number[] = [];
  private readonly lastAt: Record<MannerNotice, number> = { run: -Infinity, jump: -Infinity };

  step(dt: number, input: MannerInput): MannerNotice | null {
    const c = config();
    this.clock += dt;
    if (!input.indoor) {
      this.runSec = 0;
      this.jumps = [];
      return null;
    }
    this.runSec = input.running ? this.runSec + dt : 0;
    if (input.jumped) this.jumps.push(this.clock);
    this.jumps = this.jumps.filter(t => this.clock - t <= c.MANNER_JUMP_WINDOW_SEC);

    const ready = (n: MannerNotice): boolean => this.clock - this.lastAt[n] >= c.MANNER_COOLDOWN_SEC;
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
