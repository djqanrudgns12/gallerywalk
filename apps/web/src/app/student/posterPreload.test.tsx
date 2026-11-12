import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import type { MediaCache, PreloadProgress, PreloadResult } from '../../ports/mediaCache.ts';
import { combineProgress, type PreloadState, usePosterPreload } from './posterPreload.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeMedia = () => {
  let report: ((p: PreloadProgress) => void) | null = null;
  let finish: ((r: PreloadResult) => void) | null = null;
  let calls = 0;
  const media: MediaCache = {
    register: async () => true,
    appStarted: async () => {},
    screenResumed: async () => {},
    space: async () => ({ availableBytes: null, sufficient: null }),
    preload: (_view, onProgress) => {
      calls++;
      report = onProgress;
      return new Promise(r => (finish = r));
    },
  };
  return {
    media,
    report: (p: PreloadProgress) => report?.(p),
    finish: (r: PreloadResult) => finish?.(r),
    calls: () => calls,
  };
};

describe('포스터 미리 불러오기', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('받는 동안 진행 비율, 끝나면(공간 모자람도) 끝남 — 같은 전시면 다시 받지 않는다', async () => {
    const f = fakeMedia();
    const seen: PreloadState[] = [];
    const Probe = ({ v }: { v: ReturnType<typeof testExhibitionView> }) => {
      seen.push(usePosterPreload(v, f.media));
      return null;
    };
    const view = testExhibitionView([3]);
    root = createRoot(document.createElement('div'));
    act(() => root!.render(<Probe v={view} />));
    expect(seen.at(-1)).toEqual({ done: false, fraction: 0 });
    act(() => f.report({ kind: 'LOADING', completed: 1, total: 4, bytes: 10 }));
    expect(seen.at(-1)).toEqual({ done: false, fraction: 0.25 });
    // 내용만 바뀐 새 보기 묶음(같은 전시)
    act(() => root!.render(<Probe v={{ ...view }} />));
    expect(f.calls()).toBe(1);
    await act(async () => f.finish({ kind: 'NO_SPACE' }));
    expect(seen.at(-1)).toEqual({ done: true, fraction: 1 });
  });

  it('서비스 워커가 없으면 바로 끝남', () => {
    const seen: PreloadState[] = [];
    const Probe = () => {
      seen.push(usePosterPreload(testExhibitionView([2]), undefined));
      return null;
    };
    root = createRoot(document.createElement('div'));
    act(() => root!.render(<Probe />));
    expect(seen.at(-1)).toEqual({ done: true, fraction: 1 });
  });

  it('입장은 3D 첫 자리와 미리 불러오기가 둘 다 끝나야', () => {
    expect(combineProgress({ ready: true, progress: 1 }, { done: false, fraction: 0.5 })).toEqual({
      ready: false,
      progress: 0.75,
    });
    expect(combineProgress({ ready: true, progress: 1 }, { done: true, fraction: 1 }).ready).toBe(true);
    expect(combineProgress({ ready: false, progress: 0.4 }, { done: true, fraction: 1 })).toEqual({
      ready: false,
      progress: 0.4,
    });
  });
});
