import { config } from '@gallery/core/config';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import type { LiveHandlers } from '../../ports/index.ts';
import { type LiveVisit, type LiveVisitArgs, useLiveVisit } from './useLiveVisit.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 웹소켓 통로는 가짜: 들어갈 때의 hello·받는 쪽 손잡이·점프 보내기만 본다
const joins = vi.hoisted(() => [] as unknown[]);
const handlers = vi.hoisted(() => [] as LiveHandlers[]);
const jumpsSent = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../adapters/live/socket.ts', () => ({
  browserLiveDeps: () => ({}),
  createLiveChannel: () => ({
    join: (hello: unknown, h: LiveHandlers) => {
      joins.push(hello);
      handlers.push(h);
    },
    leave: () => {},
    sendPose: () => {},
    sendJump: () => void (jumpsSent.n += 1),
  }),
}));

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  joins.length = 0;
  handlers.length = 0;
  jumpsSent.n = 0;
});

const mount = (args: LiveVisitArgs): { current: LiveVisit | null } => {
  const got: { current: LiveVisit | null } = { current: null };
  const Probe = () => {
    got.current = useLiveVisit(args);
    return null;
  };
  root = createRoot(document.createElement('div'));
  act(() => root!.render(<Probe />));
  return got;
};

describe('useLiveVisit', () => {
  const layout = testExhibitionView([3]).layout;
  it('학생은 방문자로, 교사 미리 보기는 선생님(as teacher·교사 캐릭터)으로 들어간다(PRD 15.8)', () => {
    mount({ code: '123456', token: 'v'.repeat(43), character: 'student-f', layout, enabled: true });
    expect(joins.at(-1)).toMatchObject({ as: 'visitor', character: 'student-f' });
    act(() => root?.unmount());
    root = null;
    mount({
      code: '123456',
      token: 't'.repeat(43),
      character: 'teacher-f',
      layout,
      enabled: true,
      as: 'teacher',
    });
    expect(joins.at(-1)).toMatchObject({ as: 'teacher', character: 'teacher-f', code: '123456' });
  });

  it('sendJump는 통로로 한 번씩 보내고, 받은 jump는 버퍼에 들어가 그 사람이 포물선으로 뜬다(W-05)', () => {
    const live = mount({
      code: '123456',
      token: 'v'.repeat(43),
      character: 'student-f',
      layout,
      enabled: true,
    });
    live.current!.sendJump();
    expect(jumpsSent.n).toBe(1);
    const h = handlers[0]!;
    const peer = {
      sid: 'bbbbbbbb',
      nickname: '바다',
      role: 'visitor' as const,
      character: 'student-m' as const,
      pose: { x: 1, y: 0, z: 1, yaw: 0, move: 0 as const },
    };
    act(() => {
      h.onMessage({ t: 'welcome', you: 'aaaaaaaa', nickname: '하늘', peers: [peer], at: 1000, n: 1 }, 1000);
      h.onMessage({ t: 'jump', sid: 'bbbbbbbb', at: 1000 }, 1000);
    });
    const buffer = live.current!.buffer;
    expect(buffer.size).toBe(1);
    // 늦춘 시각으로 뜬 뒤 0.2초 → 바닥 위
    const at = 1000 + config().LIVE_INTERP_DELAY_MS + (config().CHAR_JUMP_SQUASH.crouchSec + 0.2) * 1000;
    const [v] = buffer.sample(at);
    expect(v!.air).toBeGreaterThan(0.3);
    expect(v!.y).toBeCloseTo(v!.air, 6);
    expect(buffer.busy(at)).toBe(true);
  });

  it('토큰이 없거나 꺼져 있으면 잇지 않는다', () => {
    mount({ code: '123456', token: null, character: 'teacher-m', layout, enabled: true, as: 'teacher' });
    act(() => root?.unmount());
    mount({
      code: '123456',
      token: 't'.repeat(43),
      character: 'teacher-m',
      layout,
      enabled: false,
      as: 'teacher',
    });
    expect(joins).toHaveLength(0);
  });
});
