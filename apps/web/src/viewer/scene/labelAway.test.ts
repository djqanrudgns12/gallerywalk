import { describe, expect, it } from 'vitest';
import { labelAwayOf } from './labelAway.ts';

/**
 * 명판 띄움 방향(V-57): 떠 있는 액자 앞면이 명판 안쪽을 가리지 않게, 그릴 때 벽을 따라 액자에서 먼 쪽으로 옮긴다.
 * 배치 좌표는 그대로라 이미 저장된 배치에도 같이 적용된다.
 */
describe('명판 띄움 방향', () => {
  it('벽을 따라 액자 가운데에서 명판 쪽 — 벽 법선 성분은 뺀다', () => {
    // 벽 법선 +Z(방 안쪽), 명판이 액자 왼쪽(−X)이고 벽에서 조금 앞
    const away = labelAwayOf([-1.2, 1.3, 0.02], { x: 0, z: 0.08 }, [0, 1], false);
    expect(away[0]).toBeCloseTo(-1, 9);
    expect(away[1]).toBeCloseTo(0, 9);
  });

  it('벽 법선이 X축이어도 벽을 따르는 방향(Z)만', () => {
    const away = labelAwayOf([0.03, 1.3, 2.5], { x: 0.1, z: 1.4 }, [1, 0], false);
    expect(away[0]).toBeCloseTo(0, 9);
    expect(away[1]).toBeCloseTo(1, 9);
  });

  it('이젤 명판(받침 아래)과 액자 바로 앞 명판은 옮기지 않는다', () => {
    expect(labelAwayOf([1, 0.6, 2], { x: 0, z: 2 }, [0, 1], true)).toEqual([0, 0]);
    expect(labelAwayOf([0, 0.6, 2.2], { x: 0, z: 2 }, [0, 1], false)).toEqual([0, 0]);
  });
});
