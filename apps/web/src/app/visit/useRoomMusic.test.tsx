import type { ExhibitionView } from '@gallery/core/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView, uuid } from '../../dev/testView.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine = vi.hoisted(() => ({
  unlocked: false,
  calls: [] as string[],
}));

vi.mock('../../audio/AudioEngine.ts', () => ({
  AudioEngine: class {
    async unlock() {
      engine.calls.push('unlock');
      engine.unlocked = true;
      return true;
    }
    snapshot() {
      return { unlocked: engine.unlocked };
    }
    playRoom(t: { id: string } | null) {
      engine.calls.push(`play:${t?.id ?? 'none'}`);
    }
    setMuted(m: boolean) {
      engine.calls.push(`muted:${m}`);
    }
    async resumeIfNeeded() {}
  },
}));

const { useRoomMusic } = await import('./roomMusic.ts');

const view = (): ExhibitionView => {
  const v = testExhibitionView([3, 3]);
  return {
    ...v,
    rooms: v.rooms.map((r, i) =>
      i === 0
        ? {
            ...r,
            bgm: {
              asset: {
                assetId: uuid(0x9999),
                variants: [{ name: 'audio', ext: 'mp3', w: 0, h: 0, bytes: 1 }],
              },
              durationMs: 60_000,
              analysis: { audibleStartMs: 0, audibleEndMs: 60_000, loudnessDb: -16 },
            },
          }
        : r,
    ),
  };
};

describe('useRoomMusic', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('관람 중 첫 누름에서 잠금을 풀고 그 관의 곡을, 곡 없는 곳으로 가면 끄고, 끔이면 음소거', async () => {
    const v = view();
    const room0 = v.layout.parts.find(p => p.roomId === v.rooms[0]!.id)!.partId;
    const trackId = `${v.rooms[0]!.id}:${uuid(0x9999)}`;
    const Probe = (p: { region: string; on: boolean; entered: boolean }) => {
      useRoomMusic({ view: v, region: p.region, entered: p.entered, on: p.on });
      return null;
    };
    root = createRoot(document.createElement('div'));
    act(() => root!.render(<Probe region={room0} on entered={false} />));
    expect(engine.calls).toEqual([]); // 포스터 뒤에서는 아무것도
    act(() => root!.render(<Probe region={room0} on entered />));
    expect(engine.calls).toEqual(['muted:false']);
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      await Promise.resolve();
    });
    expect(engine.calls).toEqual(['muted:false', 'unlock', `play:${trackId}`]);
    act(() => root!.render(<Probe region="spine" on entered />));
    expect(engine.calls.at(-1)).toBe('play:none');
    act(() => root!.render(<Probe region="spine" on={false} entered />));
    expect(engine.calls.at(-1)).toBe('muted:true');
  });
});
