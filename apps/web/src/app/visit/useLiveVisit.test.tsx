import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { type LiveVisitArgs, useLiveVisit } from './useLiveVisit.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 웹소켓 통로는 가짜: 들어갈 때의 hello만 본다
const joins = vi.hoisted(() => [] as unknown[]);
vi.mock('../../adapters/live/socket.ts', () => ({
  browserLiveDeps: () => ({}),
  createLiveChannel: () => ({
    join: (hello: unknown) => joins.push(hello),
    leave: () => {},
    sendPose: () => {},
  }),
}));

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  joins.length = 0;
});

const mount = (args: LiveVisitArgs) => {
  const Probe = () => {
    useLiveVisit(args);
    return null;
  };
  root = createRoot(document.createElement('div'));
  act(() => root!.render(<Probe />));
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
