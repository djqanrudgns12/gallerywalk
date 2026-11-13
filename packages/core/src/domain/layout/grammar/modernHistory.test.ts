import { describe, expect, it } from 'vitest';
import type { Fixture } from '../../../types/layout.ts';
import { config } from '../../../config.ts';
import { templateGeometry } from '../../templates/geometry.ts';
import { decorationsFor } from './modernHistory.ts';

const g = templateGeometry['modern-history'];
const anchor = (kind: Fixture['kind'], rotY = 0): Fixture => ({
  kind,
  partId: '관',
  pos: [2.03, 2.4, 4.03],
  rotY,
});

describe('근대 역사관 장식 자리', () => {
  it('대표 벽·소개판·출구에만 정적인 장식을 놓는다', () => {
    const result = decorationsFor(
      [
        anchor('nameplate'),
        anchor('introPanel'),
        anchor('exitSign'),
        anchor('easel'),
        anchor('tree'),
        anchor('corridorNameplate'),
      ],
      g,
    );
    expect(result.map(x => x.kind).sort()).toEqual([
      'artPlinth',
      'barrier',
      'exitPortal',
      'spotRail',
      'wallSconce',
      'wallSconce',
    ]);
    expect(decorationsFor([], g)).toEqual([]);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    '회전 %s에서도 바닥 소품 전체를 걸을 수 없는 벽 여유 안에 둔다',
    rotY => {
      const origin = anchor('nameplate', rotY);
      const result = decorationsFor([origin, anchor('introPanel', rotY), anchor('exitSign', rotY)], g);
      for (const item of result.filter(x => ['barrier', 'artPlinth', 'exitPortal'].includes(x.kind))) {
        const normal = [Math.sin(rotY), Math.cos(rotY)];
        const inward =
          (item.pos[0] - origin.pos[0]) * normal[0]! +
          (item.pos[2] - origin.pos[2]) * normal[1]! +
          g.fixtures.wallOffsetM;
        const halfDepth = g.decorations[item.kind].d / 2;
        expect(inward - halfDepth).toBeGreaterThanOrEqual(-0.001);
        expect(inward + halfDepth).toBeLessThanOrEqual(config().WALKABLE_WALL_MARGIN_M);
        expect(item.pos[1]).toBe(0);
      }
    },
  );

  it('입력 순서와 관계없이 결정적이며 좌표는 1mm이고 원본을 고치지 않는다', () => {
    const fixtures = [anchor('nameplate'), anchor('exitSign', Math.PI), anchor('introPanel')];
    const before = JSON.stringify(fixtures);
    const result = decorationsFor(fixtures, g);
    expect(result).toEqual(decorationsFor([...fixtures].reverse(), g));
    expect(JSON.stringify(fixtures)).toBe(before);
    for (const item of result)
      for (const v of item.pos) expect(v * 1000).toBeCloseTo(Math.round(v * 1000), 8);
  });
});
