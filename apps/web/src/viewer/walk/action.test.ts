import { config } from '@gallery/core/config';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { type ActionNpc, gateOf, resolveAction } from './action.ts';
import { useWalkKeyboard } from './input.ts';
import { useWalk, type WalkApi } from './walkStore.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const npc = (id: string, x: number, z: number): ActionNpc => ({ id, pos: [x, z], yaw: 0 });
/** +Z를 보는 나(0, 0) */
const me = { x: 0, z: 0, yaw: 0 };
const deg = (d: number): number => (d * Math.PI) / 180;

describe('행동 키 판정 resolveAction(W-01)', () => {
  const c = config();
  const r = c.NPC_TALK_RADIUS_M * 0.8;
  const halfArc = c.NPC_TALK_ARC_DEG / 2;

  it('우선순위: 앞쪽 도슨트 말걸기 > 대문 나가기 > 점프', () => {
    const gate: [number, number] = [0, -c.GATE_RADIUS_M * 0.5];
    expect(resolveAction(me, [npc('a', 0, r)], gate)).toEqual({ action: 'talk', npcId: 'a' });
    expect(resolveAction(me, [], gate)).toEqual({ action: 'exit', npcId: null });
    expect(resolveAction(me, [], null)).toEqual({ action: 'jump', npcId: null });
    // 대문이 반지름 밖이면 점프
    expect(resolveAction(me, [], [0, c.GATE_RADIUS_M * 1.01]).action).toBe('jump');
  });

  it('도슨트는 반지름 안이고 내 앞쪽 부채꼴(NPC_TALK_ARC_DEG) 안일 때만, 여럿이면 가까운 쪽', () => {
    const at = (a: number, d = r): ActionNpc => npc(`n${a}`, d * Math.sin(deg(a)), d * Math.cos(deg(a)));
    expect(resolveAction(me, [at(halfArc - 1)], null).action).toBe('talk');
    expect(resolveAction(me, [at(-(halfArc - 1))], null).action).toBe('talk');
    expect(resolveAction(me, [at(halfArc + 1)], null).action).toBe('jump');
    expect(resolveAction(me, [at(180)], null).action).toBe('jump');
    expect(resolveAction(me, [at(0, c.NPC_TALK_RADIUS_M * 1.01)], null).action).toBe('jump');
    // 뒤에 있는 도슨트는 대문을 가리지 않는다
    expect(resolveAction(me, [at(180)], [0, 1]).action).toBe('exit');
    // 몸을 돌리면 앞쪽도 돈다
    expect(resolveAction({ ...me, yaw: Math.PI }, [at(180)], null).action).toBe('talk');
    const far = npc('far', 0, r);
    const near = npc('near', 0.2, r * 0.5);
    expect(resolveAction(me, [far, near], null).npcId).toBe('near');
  });

  it('임시 대문 = 광장 바닥 중 정면에서 먼 쪽 끝 가운데, 처음 서는 자리에서는 점프(대문 반지름 밖)', () => {
    const { layout } = testExhibitionView([2]);
    const e = layout.exterior;
    const gate = gateOf(e);
    expect(gate[0]).toBe(0);
    expect(gate[1]).toBe(e.plaza.min[1]);
    expect(Math.abs(gate[1] - e.facadeZ)).toBeGreaterThan(Math.abs(e.plaza.max[1] - e.facadeZ));
    const spawn = layout.walk.spawn;
    expect(resolveAction({ x: spawn.pos[0], z: spawn.pos[2], yaw: spawn.yaw }, [], gate).action).toBe('jump');
  });

  it('배치에 대문(스키마 3)이 있으면 그 자리를 쓴다', () => {
    const { layout } = testExhibitionView([2]);
    expect(gateOf(layout.exterior, { pos: [1.5, -2.4, -30] })).toEqual([1.5, -30]);
  });
});

describe('행동 키 상태(walkStore)', () => {
  const jump = vi.fn();
  beforeEach(() => {
    useWalk.setState(useWalk.getInitialState());
    jump.mockReset();
    useWalk.setState({ api: { jump } as unknown as WalkApi });
  });
  afterEach(() => useWalk.setState(useWalk.getInitialState()));

  it('syncAction은 할 일이 바뀔 때만 쓴다(다시 그리기를 부르지 않게)', () => {
    const changed = vi.fn();
    const unsub = useWalk.subscribe(changed);
    try {
      useWalk.getState().syncAction(me);
      expect(changed).not.toHaveBeenCalled();
      useWalk.setState({ npcs: [npc('a', 0, 1)] });
      changed.mockClear();
      useWalk.getState().syncAction(me);
      useWalk.getState().syncAction({ ...me, x: 0.01 });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(useWalk.getState()).toMatchObject({ action: 'talk', actionNpcId: 'a' });
    } finally {
      unsub();
    }
  });

  it('act: 말걸기 → 요청, 나가기 → 창 열기(열린 동안은 아무것도 안 함), 점프 → 점프, 크게 보는 중은 없음', () => {
    const s = useWalk.getState();
    s.set({ action: 'talk', actionNpcId: 'a' });
    s.act();
    expect(useWalk.getState().talkRequest?.npcId).toBe('a');
    s.set({ action: 'exit', actionNpcId: null });
    s.act();
    expect(useWalk.getState().exitOpen).toBe(true);
    s.set({ action: 'jump' });
    s.act();
    expect(jump).not.toHaveBeenCalled();
    s.closeExit();
    s.act();
    expect(jump).toHaveBeenCalledTimes(1);
    s.set({ mode: 'zoom' });
    s.act();
    expect(jump).toHaveBeenCalledTimes(1);
  });
});

describe('스페이스 = 행동 키와 초점(W-01)', () => {
  const jump = vi.fn();
  let host: HTMLDivElement;
  let root: Root;
  const Keys = () => {
    useWalkKeyboard();
    return null;
  };
  const space = (target: EventTarget): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(e);
    });
    return e;
  };

  beforeEach(() => {
    useWalk.setState(useWalk.getInitialState());
    jump.mockReset();
    useWalk.setState({ api: { jump } as unknown as WalkApi });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(createElement(Keys)));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    useWalk.setState(useWalk.getInitialState());
  });

  it('HUD 단추를 마우스로 누른 뒤에도 스페이스는 점프(누른 단추는 초점을 놓는다)', () => {
    const btn = document.createElement('button');
    const pressed = vi.fn();
    btn.addEventListener('click', pressed);
    document.body.appendChild(btn);
    btn.focus();
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(btn);
    const e = space(document.activeElement ?? document.body);
    expect(e.defaultPrevented).toBe(true);
    expect(jump).toHaveBeenCalledTimes(1);
    // 꾹 누름(자동 반복)은 한 번만
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true, repeat: true }),
      );
    });
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it('키보드로 옮긴 초점의 단추에서는 스페이스가 그 단추 몫(행동 키 아님)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    // 키보드로 누른 단추(detail 0)는 초점을 놓지 않는다
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    expect(document.activeElement).toBe(btn);
    const e = space(btn);
    expect(e.defaultPrevented).toBe(false);
    expect(jump).not.toHaveBeenCalled();
  });

  it('글 입력 칸에 초점이 있으면 스페이스를 건드리지 않는다', () => {
    for (const tag of ['input', 'textarea'] as const) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      el.focus();
      const e = space(el);
      expect(e.defaultPrevented).toBe(false);
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.appendChild(editable);
    expect(space(inner).defaultPrevented).toBe(false);
    expect(jump).not.toHaveBeenCalled();
  });

  it('시트·창이 열려 있으면 스페이스를 건드리지 않고, 닫히면 다시 행동 키', () => {
    const sheet = document.createElement('section');
    sheet.setAttribute('role', 'dialog');
    document.body.appendChild(sheet);
    expect(space(document.body).defaultPrevented).toBe(false);
    expect(jump).not.toHaveBeenCalled();
    sheet.remove();
    expect(space(document.body).defaultPrevented).toBe(true);
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it('도슨트 앞에서 스페이스 → 말걸기 요청(점프 아님)', () => {
    useWalk.getState().set({ npcs: [npc('docent-1', 0, 1)] });
    useWalk.getState().syncAction(me);
    space(document.body);
    expect(useWalk.getState().talkRequest?.npcId).toBe('docent-1');
    expect(jump).not.toHaveBeenCalled();
  });
});
