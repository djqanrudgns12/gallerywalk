import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { prefersReducedMotion, REDUCED_MOTION_QUERY } from './motion.ts';
import {
  createWakeLock,
  shouldHoldWakeLock,
  useWakeLock,
  type WakeDocument,
  type WakeNavigator,
  type WakeSentinel,
  wakeLockSupported,
} from './wakeLock.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 가짜 기기: 잡은 것·놓은 것을 센다. `refuse`면 거절(배터리 절약 등) */
const fakeDevice = (opts: { refuse?: boolean } = {}) => {
  const sentinels: { released: boolean }[] = [];
  let visibility: DocumentVisibilityState = 'visible';
  const listeners = new Set<() => void>();
  const nav: WakeNavigator = {
    wakeLock: {
      request: async () => {
        if (opts.refuse) throw new Error('NotAllowedError');
        const s: WakeSentinel & { released: boolean } = {
          released: false,
          release: async () => {
            s.released = true;
          },
        };
        sentinels.push(s);
        return s;
      },
    },
  };
  const doc: WakeDocument = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
  };
  const setVisible = (v: boolean): void => {
    visibility = v ? 'visible' : 'hidden';
    for (const fn of listeners) fn();
  };
  const held = (): number => sentinels.filter(s => !s.released).length;
  return { nav, doc, sentinels, setVisible, held, listeners };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

describe('화면 꺼짐 막기 판정', () => {
  it('지원 여부', () => {
    expect(wakeLockSupported(fakeDevice().nav)).toBe(true);
    expect(wakeLockSupported({})).toBe(false);
    expect(wakeLockSupported(null)).toBe(false);
  });
  it('관람 중이고 보일 때만 잡는다', () => {
    expect(shouldHoldWakeLock(true, 'visible')).toBe(true);
    expect(shouldHoldWakeLock(true, 'hidden')).toBe(false);
    expect(shouldHoldWakeLock(false, 'visible')).toBe(false);
  });
});

describe('createWakeLock', () => {
  it('들어오면 잡고, 숨으면 놓고, 돌아오면 다시 잡고, 떠나면 놓는다', async () => {
    const d = fakeDevice();
    const w = createWakeLock(d);
    expect(d.sentinels).toHaveLength(0);
    w.setActive(true);
    await settle();
    expect(d.held()).toBe(1);
    d.setVisible(false);
    await settle();
    expect(d.held()).toBe(0);
    d.setVisible(true);
    await settle();
    expect(d.sentinels).toHaveLength(2);
    expect(d.held()).toBe(1);
    w.setActive(false);
    await settle();
    expect(d.held()).toBe(0);
    w.dispose();
    expect(d.listeners.size).toBe(0);
  });

  it('잡는 사이 숨었으면 받자마자 놓는다', async () => {
    const d = fakeDevice();
    const w = createWakeLock(d);
    w.setActive(true);
    d.setVisible(false);
    await settle();
    expect(d.sentinels).toHaveLength(1);
    expect(d.held()).toBe(0);
    w.dispose();
  });

  it('숨어 있을 때 들어오면 잡지 않다가 보이면 잡는다', async () => {
    const d = fakeDevice();
    d.setVisible(false);
    const w = createWakeLock(d);
    w.setActive(true);
    await settle();
    expect(d.sentinels).toHaveLength(0);
    d.setVisible(true);
    await settle();
    expect(d.held()).toBe(1);
    w.dispose();
    expect(d.held()).toBe(0);
  });

  it('지원하지 않거나 거절되면 조용히 넘어간다', async () => {
    const none = createWakeLock({ nav: {}, doc: fakeDevice().doc });
    expect(() => none.setActive(true)).not.toThrow();
    none.dispose();
    const d = fakeDevice({ refuse: true });
    const w = createWakeLock(d);
    w.setActive(true);
    await settle();
    expect(d.held()).toBe(0);
    d.setVisible(false);
    d.setVisible(true);
    await settle();
    w.dispose();
  });
});

describe('useWakeLock', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('active가 켜지면 잡고, 꺼지거나 화면을 내리면 놓는다', async () => {
    const d = fakeDevice();
    const env = { nav: d.nav, doc: d.doc };
    const Probe = ({ on }: { on: boolean }) => {
      useWakeLock(on, env);
      return null;
    };
    root = createRoot(document.createElement('div'));
    await act(async () => root!.render(<Probe on={false} />));
    expect(d.sentinels).toHaveLength(0);
    await act(async () => root!.render(<Probe on />));
    await act(settle);
    expect(d.held()).toBe(1);
    await act(async () => root!.render(<Probe on={false} />));
    expect(d.held()).toBe(0);
    await act(async () => root!.render(<Probe on />));
    await act(settle);
    expect(d.held()).toBe(1);
    act(() => root!.unmount());
    root = null;
    expect(d.held()).toBe(0);
  });
});

describe('동작 줄이기 판정', () => {
  it('기기 설정이 켜져 있으면 true, matchMedia가 없거나 실패하면 false', () => {
    const asked: string[] = [];
    const on = {
      matchMedia: (q: string) => {
        asked.push(q);
        return { matches: true };
      },
    };
    expect(prefersReducedMotion(on)).toBe(true);
    expect(asked).toEqual([REDUCED_MOTION_QUERY]);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error('nope');
        },
      }),
    ).toBe(false);
  });
});
