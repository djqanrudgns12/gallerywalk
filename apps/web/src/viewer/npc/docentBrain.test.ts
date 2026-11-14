import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import type { Layout } from '@gallery/core/types';
import { afterEach, describe, expect, it } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import {
  DocentBrain,
  type DocentInput,
  type DocentMe,
  type DocentOutput,
  docentKindOf,
  docentLines,
  docentLineText,
  drawnDocentIds,
  nodSec,
} from './docentBrain.ts';
import { DocentDirector, docentSpotsOf } from './docentDirector.ts';
import { docentTuning } from './tuning.ts';

const deg = (d: number): number => (d * Math.PI) / 180;
/** 도슨트(0, 0, +Z를 봄) 기준 각 `a`(도)·거리 `d`에 선 나 — 도슨트를 바라본다 */
const at = (a: number, d: number): DocentMe => {
  const x = d * Math.sin(deg(a));
  const z = d * Math.cos(deg(a));
  return { x, z, yaw: Math.atan2(-x, -z) };
};
const HALL = { id: 'docent-hall', pos: [0, 0] as const, yaw: 0 };
const zero = (): number => 0;
const brainOf = (rng: () => number = zero): DocentBrain => new DocentBrain(HALL, docentLines(HALL.id), rng);
const input = (now: number, me: DocentMe | null, extra: Partial<DocentInput> = {}): DocentInput => ({
  now,
  me,
  walking: false,
  calm: false,
  ...extra,
});
/** `from`부터 `to`까지 `step`초 간격으로 돌리고 마지막 결과 */
const run = (
  b: DocentBrain,
  from: number,
  to: number,
  me: DocentMe | null,
  extra: Partial<DocentInput> = {},
  step = 0.05,
): DocentOutput => {
  let out = b.update(input(from, me, extra));
  for (let t = from + step; t <= to + 1e-9; t += step) out = b.update(input(t, me, extra));
  return out;
};

afterEach(() => resetConfig());

describe('도슨트 대사 묶음', () => {
  it('자리 ID → 구역 줄 번호(copy.museumDocent.zones), 모르는 자리는 모든 줄', () => {
    expect(docentKindOf('docent-plaza')).toBe('plaza');
    expect(docentKindOf('docent-hall')).toBe('hall');
    expect(docentKindOf('docent-room')).toBe('room');
    expect(docentKindOf('toString')).toBeNull();
    expect(docentLines('docent-room')).toEqual(copy.museumDocent.zones.room);
    expect(docentLines('x')).toHaveLength(copy.museumDocent.lines.length);
    expect(docentLineText(1)).toBe(copy.museumDocent.lines[0]);
    expect(docentLineText(99)).toBe('');
  });
});

describe('도슨트 바라보기(W-10)', () => {
  const c = config();

  it('4m 안이면 몸을 나에게 돌린다 — 60° 안이면 몸만, 넘으면 남는 만큼 고개(고개 한계까지)', () => {
    const near = c.NPC_LOOK_RADIUS_M * 0.75;
    const b30 = run(brainOf(), 0, 3, at(30, near));
    expect(b30.bodyYaw).toBeCloseTo(deg(30), 3);
    expect(b30.headYaw).toBeCloseTo(0, 3);
    const b90 = run(brainOf(), 0, 3, at(90, near));
    expect(b90.bodyYaw).toBeCloseTo(deg(c.NPC_LOOK_MAX_DEG), 3);
    expect(b90.headYaw).toBeCloseTo(deg(90 - c.NPC_LOOK_MAX_DEG), 3);
    const b150 = run(brainOf(), 0, 3, at(-150, near));
    expect(b150.bodyYaw).toBeCloseTo(-deg(c.NPC_LOOK_MAX_DEG), 3);
    expect(b150.headYaw).toBeCloseTo(-deg(docentTuning().headMaxDeg), 3);
    expect(b150.busy).toBe(false);
  });

  it('`NPC_TURN_RAD_PER_S`보다 빨리 돌지 않고, 반지름 밖으로 나가면 쉬는 방향으로 돌아온다', () => {
    const b = brainOf();
    b.update(input(0, at(50, 2)));
    const first = b.update(input(0.1, at(50, 2)));
    expect(Math.abs(first.bodyYaw)).toBeLessThanOrEqual(c.NPC_TURN_RAD_PER_S * 0.1 + 1e-9);
    expect(first.busy).toBe(true);
    run(b, 0.15, 3, at(50, 2));
    const back = run(b, 3, 6, at(50, c.NPC_LOOK_RADIUS_M * 1.2));
    expect(back.bodyYaw).toBeCloseTo(0, 6);
    expect(back.headYaw).toBeCloseTo(0, 6);
    // 오래 멈췄다 그려도 한 번에 휙 돌지 않는다
    const jump = brainOf();
    jump.update(input(0, at(50, 2)));
    expect(Math.abs(jump.update(input(30, at(50, 2))).bodyYaw)).toBeLessThanOrEqual(
      c.NPC_TURN_RAD_PER_S * docentTuning().dtMaxSec + 1e-9,
    );
  });

  it('동작 줄이기면 바로 돌아서고 손짓·끄덕임이 없다', () => {
    const b = brainOf();
    const out = b.update(input(0, at(40, 2), { calm: true }));
    expect(out.bodyYaw).toBeCloseTo(deg(40), 6);
    expect(out.gesture).toBeNull();
    b.talk(1, true);
    const t = b.update(input(1.1, at(40, 2), { calm: true }));
    expect(t.talk).not.toBeNull();
    expect(t.nod).toBeNull();
    expect(t.gesture).toBeNull();
    expect(t.busy).toBe(false);
  });
});

describe('도슨트 인사 손짓', () => {
  const c = config();

  it('바라보기 반지름 안으로 새로 들어오고 도슨트가 내 앞쪽이면 손 흔들기, 쉬는 시간 안에는 다시 안 함', () => {
    const b = brainOf();
    b.update(input(0, at(0, c.NPC_LOOK_RADIUS_M + 1)));
    const hi = b.update(input(0.1, at(0, c.NPC_LOOK_RADIUS_M - 0.5)));
    expect(hi.gesture?.kind).toBe('wave');
    const done = run(b, 0.15, 0.1 + c.CHAR_WAVE_SEC + 0.1, at(0, c.NPC_LOOK_RADIUS_M - 0.5));
    expect(done.gesture).toBeNull();
    // 나갔다 쉬는 시간 안에 다시 들어오면 없음
    b.update(input(4, at(0, c.NPC_LOOK_RADIUS_M + 1)));
    expect(b.update(input(4.1, at(0, c.NPC_LOOK_RADIUS_M - 0.5))).gesture).toBeNull();
    // 쉬는 시간이 지나면 다시
    const later = 0.1 + c.CHAR_GREET_COOLDOWN_SEC + 1;
    b.update(input(later, at(0, c.NPC_LOOK_RADIUS_M + 1)));
    expect(b.update(input(later + 0.1, at(0, c.NPC_LOOK_RADIUS_M - 0.5))).gesture?.kind).toBe('wave');
  });

  it('도슨트를 등지고 들어오면 흔들지 않는다', () => {
    const b = brainOf();
    const away = (d: number): DocentMe => ({ ...at(0, d), yaw: 0 });
    b.update(input(0, away(c.NPC_LOOK_RADIUS_M + 1)));
    expect(b.update(input(0.1, away(c.NPC_LOOK_RADIUS_M - 0.5))).gesture).toBeNull();
  });
});

describe('이따금 한마디(NPC_TIP_*)', () => {
  const c = config();

  it('10m 안에 들어온 뒤 무작위 간격(난수 0 → 최소)에 한마디를 `NPC_TIP_SHOW_SEC` 동안, 다음 줄은 다르다', () => {
    const b = brainOf();
    const me = at(20, c.NPC_TIP_RADIUS_M * 0.8);
    const first = b.update(input(0, me));
    expect(first.speech).toBeNull();
    expect(first.wakeAt).toBeCloseTo(c.NPC_TIP_SEC.min, 6);
    expect(first.busy).toBe(false);
    expect(b.update(input(c.NPC_TIP_SEC.min - 0.01, me)).speech).toBeNull();
    const tip = b.update(input(c.NPC_TIP_SEC.min, me)).speech;
    expect(tip?.kind).toBe('tip');
    expect(copy.museumDocent.zones.hall).toContain(tip?.line);
    const showing = b.update(input(c.NPC_TIP_SEC.min + 0.5, me));
    expect(showing.nod).not.toBeNull();
    expect(showing.wakeAt).toBeCloseTo(c.NPC_TIP_SEC.min + c.NPC_TIP_SHOW_SEC, 6);
    expect(b.update(input(c.NPC_TIP_SEC.min + nodSec() + 0.01, me)).nod).toBeNull();
    expect(b.update(input(c.NPC_TIP_SEC.min + c.NPC_TIP_SHOW_SEC + 0.01, me)).speech).toBeNull();
    const next = b.update(input(c.NPC_TIP_SEC.min * 2, me)).speech;
    expect(next?.kind).toBe('tip');
    expect(next?.line).not.toBe(tip?.line);
  });

  it('간격은 `NPC_TIP_SEC` 범위 안의 무작위, 반지름 밖으로 나가면 지우고 다시 잰다', () => {
    const half = brainOf(() => 0.5);
    const me = at(0, 6);
    const mid = (c.NPC_TIP_SEC.min + c.NPC_TIP_SEC.max) / 2;
    expect(half.update(input(0, me)).wakeAt).toBeCloseTo(mid, 6);
    half.update(input(mid, me));
    const gone = half.update(input(mid + 1, at(0, c.NPC_TIP_RADIUS_M + 1)));
    expect(gone.speech).toBeNull();
    expect(gone.wakeAt).toBeNull();
    expect(half.update(input(mid + 2, me)).wakeAt).toBeCloseTo(mid + 2 + mid, 6);
  });

  it('멀리 아무도 없으면 바쁘지 않고 깨울 시각도 없다(정지 상태 다시 그리기 없음)', () => {
    const b = brainOf();
    for (const me of [null, at(0, c.NPC_TIP_RADIUS_M + 5)]) {
      const out = run(b, 0, 2, me);
      expect(out.busy).toBe(false);
      expect(out.wakeAt).toBeNull();
      expect(out.speech).toBeNull();
    }
  });
});

describe('말걸기(W-01·W-10)', () => {
  const c = config();
  const close = at(0, c.NPC_TALK_RADIUS_M * 0.6);

  it('누를 때마다 섞은 주머니 순서로 한 줄씩 — 한 바퀴 동안 같은 줄 없음, 다음 바퀴 첫 줄은 지난 줄과 다름', () => {
    let s = 7;
    const rng = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const b = brainOf(rng);
    const lines = copy.museumDocent.zones.hall;
    const got: number[] = [];
    for (let i = 0; i < lines.length * 3; i++) got.push(b.talk(i).line);
    for (let r = 0; r < 3; r++)
      expect([...got.slice(r * lines.length, (r + 1) * lines.length)].sort((x, y) => x - y)).toEqual(
        [...lines].sort((x, y) => x - y),
      );
    for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1]);
  });

  it('대사는 `NPC_TALK_SHOW_SEC` 동안 머리 위·카드에(안내 손짓·끄덕임과 함께), 끝나면 닫힌다', () => {
    const b = brainOf();
    // 다가오며 받은 인사 손짓이 끝난 뒤 말을 건다(손짓은 겹쳐 시작하지 않음)
    const t0 = c.CHAR_WAVE_SEC + 0.2;
    expect(b.update(input(0, close)).gesture?.kind).toBe('wave');
    run(b, 0.05, t0 - 0.05, close);
    const s = b.talk(t0);
    expect(s.until).toBeCloseTo(t0 + c.NPC_TALK_SHOW_SEC, 6);
    const open = b.update(input(t0 + 0.1, close));
    expect(open.talk).toEqual(s);
    expect(open.speech).toEqual(s);
    expect(open.busy).toBe(true);
    expect(open.gesture?.kind).toBe('guide');
    expect(open.nod).not.toBeNull();
    expect(b.update(input(t0 + c.NPC_TALK_SHOW_SEC + 0.01, close)).talk).toBeNull();
  });

  it('말걸기 반지름 밖으로 멀어지면 닫는다', () => {
    const b = brainOf();
    b.update(input(0, close));
    b.talk(0);
    expect(b.update(input(0.5, at(0, c.NPC_TALK_RADIUS_M * 0.99))).talk).not.toBeNull();
    expect(b.update(input(0.6, at(0, c.NPC_TALK_RADIUS_M * 1.01))).talk).toBeNull();
  });

  it('서서 말을 건 뒤 걸으면 닫는다 · 걸으면서 누르면 한 번 멈춘 뒤 다시 걸을 때 닫는다', () => {
    const b = brainOf();
    b.update(input(0, close));
    b.talk(0.1);
    expect(b.update(input(0.2, close, { walking: true })).talk).toBeNull();

    const w = brainOf();
    w.update(input(0, close, { walking: true }));
    w.talk(0.1);
    expect(w.update(input(0.2, close, { walking: true })).talk).not.toBeNull();
    expect(w.update(input(0.3, close)).talk).not.toBeNull();
    expect(w.update(input(0.4, close, { walking: true })).talk).toBeNull();
  });

  it('닫기를 누르면 닫고, 말걸기 대사가 떠 있는 동안 한마디는 미룬다(대사와 한마디가 같은 줄을 잇지 않음)', () => {
    const b = brainOf();
    b.update(input(0, close));
    b.talk(c.NPC_TIP_SEC.min - 1);
    const during = b.update(input(c.NPC_TIP_SEC.min, close));
    expect(during.speech?.kind).toBe('talk');
    expect(during.wakeAt).toBeCloseTo(c.NPC_TIP_SEC.min - 1 + c.NPC_TALK_SHOW_SEC, 6);
    b.closeTalk();
    expect(b.update(input(c.NPC_TIP_SEC.min + 0.1, close)).talk).toBeNull();
    // 한마디와 말걸기를 섞어도 연달아 같은 줄이 없다
    const mix = brainOf(() => 0.3);
    let now = 0;
    let prev: number | null = null;
    mix.update(input(now, close));
    for (let i = 0; i < 40; i++) {
      now += c.NPC_TIP_SEC.max + c.NPC_TALK_SHOW_SEC;
      const line: number | undefined =
        i % 2 === 0 ? mix.talk(now).line : mix.update(input(now, close)).speech?.line;
      if (line === undefined) continue;
      expect(line).not.toBe(prev);
      prev = line;
      mix.closeTalk();
      mix.update(input(now + c.NPC_TALK_SHOW_SEC + 0.01, close));
    }
  });
});

describe('그릴 도슨트 drawnDocentIds', () => {
  const spots = [
    { id: 'docent-plaza', zone: 'plaza' },
    { id: 'docent-hall', zone: 'hall' },
    { id: 'docent-room', zone: 'p2' },
  ];

  it('바깥은 광장 도슨트만, 실내는 홀 + 그리는 관 안의 도슨트(많아야 둘)', () => {
    expect([...drawnDocentIds(spots, 'exterior', new Set(['p1']))]).toEqual(['docent-plaza']);
    expect([...drawnDocentIds(spots, 'spine', new Set(['p1']))]).toEqual(['docent-hall']);
    expect([...drawnDocentIds(spots, 'p2', new Set(['p2', 'p1']))]).toEqual(['docent-hall', 'docent-room']);
  });
});

describe('도슨트 묶음 DocentDirector', () => {
  const c = config();
  const spots = [
    { id: 'docent-plaza', zone: 'plaza', pos: [0, -20] as const, y: 0, yaw: 0 },
    { id: 'docent-hall', zone: 'hall', pos: [0, 0] as const, y: 0, yaw: 0 },
  ];

  it('그리는 도슨트만 말걸기를 받고 나를 본다, 말걸기 대사가 한마디보다 먼저 머리 위에', () => {
    const d = new DocentDirector(spots, zero);
    d.setDrawn(new Set(['docent-hall']));
    expect(d.talk('docent-plaza', 0)).toBeNull();
    const me = { x: 0, z: 1.5, yaw: Math.PI };
    d.step({ now: 0, me, walking: false, calm: false });
    expect(d.talk('docent-hall', 0.1)).not.toBeNull();
    const f = d.step({ now: 0.2, me, walking: false, calm: false });
    expect(f.talk?.npcId).toBe('docent-hall');
    expect(f.bubble?.speech.kind).toBe('talk');
    expect(f.busy).toBe(true);
    // 그리지 않는 광장 도슨트는 아무도 없는 것으로(깨울 시각도 없음)
    expect(f.outs.get('docent-plaza')?.distance).toBe(Number.POSITIVE_INFINITY);
    d.closeTalk();
    expect(d.step({ now: 0.3, me, walking: false, calm: false }).talk).toBeNull();
  });

  it('배치: 스키마 2는 도슨트 없음, 공간 v4(스키마 3)는 세 자리', () => {
    expect(docentSpotsOf(testExhibitionView([4]).layout as Layout)).toEqual([]);
    overrideConfig({ ALGO_VERSION: 4 });
    const v4 = testExhibitionView([4, 4, 4]).layout;
    expect(v4.schemaVersion).toBe(3);
    const ids = docentSpotsOf(v4).map(s => s.id);
    expect(ids).toEqual(['docent-plaza', 'docent-hall', 'docent-room']);
    for (const s of docentSpotsOf(v4)) expect(docentLines(s.id).length).toBeGreaterThan(1);
    expect(c.NPC_TALK_RADIUS_M).toBeLessThan(c.NPC_LOOK_RADIUS_M);
  });
});
