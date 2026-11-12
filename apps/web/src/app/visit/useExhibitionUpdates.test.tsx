import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import type { ExhibitionView, VersionInfo } from '@gallery/core/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import {
  planUpdate,
  type UpdatePlan,
  type UpdatesArgs,
  useExhibitionUpdates,
} from './useExhibitionUpdates.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bump = (v: ExhibitionView, patch: Partial<ExhibitionView['versions']>): ExhibitionView => ({
  ...v,
  versions: { ...v.versions, ...patch },
});

describe('planUpdate', () => {
  it('배치가 그대로면 새 내용에 옛 배치 객체를 그대로 붙인다(걷던 장면이 흔들리지 않게)', () => {
    const cur = testExhibitionView([4]);
    const next = bump(testExhibitionView([4]), { contentVersion: 9 });
    const plan = planUpdate(cur, next, null);
    expect(plan.kind).toBe('APPLY');
    expect(plan.view.layout).toBe(cur.layout);
    expect(plan.view.versions.contentVersion).toBe(9);
  });

  it('배치가 바뀌었고 지금 관이 그대로면 바로 적용, 지금 관이 바뀌었으면 띠', () => {
    const cur = testExhibitionView([4, 5]);
    // 둘째 전시실에 작품이 늘어남 → 첫 관은 그대로, 둘째 관은 바뀜
    const next = bump(testExhibitionView([4, 7]), { layoutVersion: 2 });
    const firstArt = cur.layout.stops.find(
      s => s.kind === 'artwork' && s.partId === cur.layout.parts[0]!.partId,
    )!;
    const secondArt = cur.layout.stops.find(
      s => s.kind === 'artwork' && s.partId === cur.layout.parts.at(-1)!.partId,
    )!;
    expect(planUpdate(cur, next, firstArt.id).kind).toBe('APPLY');
    expect(planUpdate(cur, next, secondArt.id).kind).toBe('BANNER');
    // 외관·홀(관 밖)에 있으면 조용히
    expect(planUpdate(cur, next, cur.layout.stops[0]!.id).kind).toBe('APPLY');
  });
});

describe('useExhibitionUpdates', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.useRealTimers();
  });

  const mount = (args: UpdatesArgs) => {
    const Probe = () => {
      useExhibitionUpdates(args);
      return null;
    };
    const el = document.createElement('div');
    root = createRoot(el);
    act(() => root!.render(<Probe />));
  };

  it('관람 중에만 CHANGE_POLL_SEC마다 확인하고, 닫힘이면 알리고, 내용이 바뀌면 새 보기 묶음을 받아 적용 계획을 낸다', async () => {
    vi.useFakeTimers();
    const view = testExhibitionView([3]);
    let status: VersionInfo['status'] = 'OPEN';
    let content = view.versions.contentVersion;
    const versions = vi.fn(async (): Promise<VersionInfo> => ({
      ...view.versions,
      contentVersion: content,
      status,
    }));
    const exhibition = vi.fn(async () => bump(view, { contentVersion: content }));
    const plans: UpdatePlan[] = [];
    const onClosed = vi.fn();
    mount({
      code: '123456',
      view,
      enabled: true,
      student: { versions, exhibition },
      currentStopId: () => null,
      onPlan: p => plans.push(p),
      onClosed,
      onNotReady: vi.fn(),
    });
    const pollMs = config().CHANGE_POLL_SEC * 1000;
    await act(async () => void (await vi.advanceTimersByTimeAsync(pollMs - 2000)));
    expect(versions).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(versions).toHaveBeenCalledTimes(1);
    expect(exhibition).not.toHaveBeenCalled(); // 바뀐 것 없음
    content += 1;
    await act(async () => void (await vi.advanceTimersByTimeAsync(pollMs)));
    expect(exhibition).toHaveBeenCalledTimes(1);
    expect(plans.at(-1)?.kind).toBe('APPLY');
    status = 'CLOSED';
    await act(async () => void (await vi.advanceTimersByTimeAsync(pollMs)));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('관람 중 전시가 사라지면(E_NOT_FOUND) 닫힘으로 알리고 보기 묶음을 한 번 더 불러 기기 사본을 지우게 한다, 끊김은 그대로', async () => {
    vi.useFakeTimers();
    const view = testExhibitionView([3]);
    let fail: AppError = new AppError('E_OFFLINE');
    const versions = vi.fn(async (): Promise<VersionInfo> => {
      throw fail;
    });
    const exhibition = vi.fn(async () => {
      throw new AppError('E_NOT_FOUND');
    });
    const onClosed = vi.fn();
    mount({
      code: '123456',
      view,
      enabled: true,
      student: { versions, exhibition },
      currentStopId: () => null,
      onPlan: vi.fn(),
      onClosed,
      onNotReady: vi.fn(),
    });
    const pollMs = config().CHANGE_POLL_SEC * 1000;
    await act(async () => void (await vi.advanceTimersByTimeAsync(pollMs + 1000)));
    expect(versions).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    fail = new AppError('E_NOT_FOUND');
    await act(async () => void (await vi.advanceTimersByTimeAsync(pollMs)));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(exhibition).toHaveBeenCalledTimes(1);
  });

  it('알고 있는 만료 시각이 지났으면 묻지 않고 닫힘으로', async () => {
    vi.useFakeTimers();
    const view = testExhibitionView([3]);
    const versions = vi.fn(async (): Promise<VersionInfo> => ({ ...view.versions, status: 'OPEN' }));
    const onClosed = vi.fn();
    mount({
      code: '123456',
      view,
      enabled: true,
      student: { versions, exhibition: vi.fn() },
      currentStopId: () => null,
      onPlan: vi.fn(),
      onClosed,
      onNotReady: vi.fn(),
      // 타이머와 함께 가는 시계를 만료 바로 뒤로 옮긴다
      now: (
        skew => () =>
          Date.now() + skew
      )(view.exhibition.expiresAt + 1 - Date.now()),
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(config().CHANGE_POLL_SEC * 1000 + 1000)));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(versions).not.toHaveBeenCalled();
  });

  it('들어오기 전(포스터)에는 확인하지 않는다', async () => {
    vi.useFakeTimers();
    const view = testExhibitionView([3]);
    const versions = vi.fn(async (): Promise<VersionInfo> => ({ ...view.versions, status: 'OPEN' }));
    mount({
      code: '123456',
      view,
      enabled: false,
      student: { versions, exhibition: vi.fn() },
      currentStopId: () => null,
      onPlan: vi.fn(),
      onClosed: vi.fn(),
      onNotReady: vi.fn(),
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(config().CHANGE_POLL_SEC * 3000)));
    expect(versions).not.toHaveBeenCalled();
  });
});
