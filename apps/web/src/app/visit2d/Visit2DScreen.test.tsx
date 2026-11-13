import { copy, fill } from '@gallery/core/copy';
import { type ExhibitionView, mediaPath } from '@gallery/core/types';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReactionServices } from '../../dev/reactionFixtures.ts';
import { testArtworkId, testAssetId, testExhibitionView, testRoomId, uuid } from '../../dev/testView.ts';
import { memoryOutboxStorage } from '../reactions/outbox.ts';
import { installReactionRuntime } from '../reactions/reactionRuntime.ts';
import { ServicesContext } from '../services.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 소리 엔진 대역: 부른 것을 차례로 적는다 */
const engine = vi.hoisted(() => ({ unlocked: false, calls: [] as string[] }));
vi.mock('../../audio/AudioEngine.ts', () => ({
  AudioEngine: class {
    async unlock() {
      engine.calls.push('unlock');
      engine.unlocked = true;
      return true;
    }
    snapshot() {
      return { unlocked: engine.unlocked, artwork: { id: null, paused: true } };
    }
    playRoom(t: { id: string } | null) {
      engine.calls.push(`room:${t?.id ?? 'none'}`);
    }
    playArtwork(t: { id: string }) {
      engine.calls.push(`art:${t.id}`);
    }
    stopArtwork() {
      engine.calls.push('stopArt');
    }
    setMuted(m: boolean) {
      engine.calls.push(`muted:${m}`);
    }
    async resumeIfNeeded() {}
  },
}));

const { Visit2DScreen } = await import('./Visit2DScreen.tsx');
type Props = Parameters<typeof Visit2DScreen>[0];

const BGM_ID = uuid(0x9999);
const AUDIO_ART = testArtworkId(1, 1);

/** 전시실 2곳(4점·3점): 1관 4번째는 글 작품(시험 보기 묶음), 2관 2번째는 소리 작품, 1관에는 배경음악 */
const view = (sizes: readonly number[] = [4, 3]): ExhibitionView => {
  const v = testExhibitionView(sizes);
  return {
    ...v,
    rooms: v.rooms.map((r, i) =>
      i === 0
        ? {
            ...r,
            bgm: {
              asset: { assetId: BGM_ID, variants: [{ name: 'audio', ext: 'mp3', w: 0, h: 0, bytes: 1 }] },
              durationMs: 60_000,
              analysis: { audibleStartMs: 0, audibleEndMs: 60_000, loudnessDb: -16 },
            },
          }
        : r,
    ),
    artworks: v.artworks.map(a =>
      a.id === AUDIO_ART
        ? {
            ...a,
            kind: 'AUDIO' as const,
            form: 'SOUND' as const,
            title: '가상의 노래',
            image: null,
            audio: {
              asset: {
                assetId: testAssetId(1, 1),
                variants: [{ name: 'audio', ext: 'mp3', w: 0, h: 0, bytes: 1 }],
              },
              durationMs: 30_000,
              analysis: { audibleStartMs: 0, audibleEndMs: 30_000, loudnessDb: -14 },
              cover: null,
            },
          }
        : a,
    ),
  };
};

const artworkStops = (v: ExhibitionView) => v.layout.stops.filter(s => s.kind === 'artwork');

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  engine.calls.length = 0;
  engine.unlocked = false;
});

const mount = (props: Partial<Props> & { readonly wrap?: (n: ReactNode) => ReactNode } = {}) => {
  const { wrap, ...rest } = props;
  const p: Props = { view: view(), code: '123456', onHome: () => undefined, ...rest };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (next: Partial<Props> = {}) =>
    act(() => {
      const el = <Visit2DScreen {...p} {...next} />;
      root!.render(wrap ? wrap(el) : el);
    });
  render();
  const q = <E extends Element = HTMLElement>(sel: string): E | null => host!.querySelector<E>(sel);
  const stage = () => q('[data-testid="visit-2d"]')!;
  return {
    q,
    render,
    stage,
    stop: () => stage().getAttribute('data-stop'),
    kind: () => stage().getAttribute('data-kind'),
    next: () => click(q('[data-testid="visit2d-next"]')),
    prev: () => click(q('[data-testid="visit2d-prev"]')),
  };
};

const click = (el: Element | null): void => {
  if (!(el instanceof HTMLElement)) throw new Error('click: element not found');
  act(() => el.click());
};

const byText = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text) ?? null;

const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = window): void =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init }));
  });

const pointer = (el: Element, type: 'pointerdown' | 'pointerup', x: number, y = 100): void =>
  act(() => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, isPrimary: true });
    el.dispatchEvent(e);
  });

describe('2D 대체 화면 넘기기', () => {
  it('전시실 첫 작품에서 그 전시실 소개 글(교사가 쓴 것)을 보이고, 다음 작품에서는 감춘다(V-03)', () => {
    const v = testExhibitionView([3, 4]);
    const withIntro = { ...v, rooms: v.rooms.map((r, i) => (i === 0 ? { ...r, intro: '가상 소개 글' } : r)) };
    const m = mount({ view: withIntro });
    expect(m.q('[data-testid="visit2d-room-intro"]')?.textContent).toContain('가상 소개 글');
    click(m.q('[data-testid="visit2d-next"]'));
    expect(m.q('[data-testid="visit2d-room-intro"]')).toBeNull();
  });

  it('위 전시실 탭: 지금 전시실이 표시되고, 누르면 그 전시실 첫 작품으로', () => {
    const v = testExhibitionView([3, 4]);
    const m = mount({ view: v });
    const tabs = m.q('[data-testid="visit2d-tabs"]')!;
    const buttons = Array.from(tabs.querySelectorAll('button'));
    expect(buttons.map(b => b.textContent)).toEqual(['전시실 1', '전시실 2']);
    expect(buttons[0]!.getAttribute('aria-current')).toBe('true');
    click(buttons[1]!);
    const room2Part = v.layout.parts.find(p => p.roomId === testRoomId(1))!.partId;
    const firstOfRoom2 = v.layout.stops.find(s => s.kind === 'artwork' && s.partId === room2Part)!;
    expect(m.stop()).toBe(firstOfRoom2.id);
    expect(buttons[1]!.getAttribute('aria-current')).toBe('true');
  });

  it('정지 지점 순서대로 작품만 한 칸씩, 처음에서는 이전이 잠기고, 끝은 출구(다음이 잠김)', () => {
    const v = view();
    const m = mount({ view: v });
    const order = artworkStops(v).map(s => s.id);
    expect(m.stop()).toBe(order[0]);
    expect(m.q<HTMLButtonElement>('[data-testid="visit2d-prev"]')?.disabled).toBe(true);
    const seen = [m.stop()];
    for (let i = 1; i < order.length; i++) {
      m.next();
      seen.push(m.stop());
    }
    expect(seen).toEqual(order);
    m.next();
    expect(m.kind()).toBe('exit');
    expect(m.q<HTMLButtonElement>('[data-testid="visit2d-next"]')?.disabled).toBe(true);
    m.next();
    expect(m.kind()).toBe('exit');
    m.prev();
    expect(m.stop()).toBe(order.at(-1));
  });

  it('출구: 고마움 인사·작품 수 + 처음부터 다시 보기(첫 작품) · 처음으로(onHome)', () => {
    const v = view();
    const onHome = vi.fn();
    const m = mount({ view: v, onHome });
    for (let i = 0; i < artworkStops(v).length; i++) m.next();
    const exit = m.q('[data-testid="visit2d-exit"]')!;
    expect(exit.textContent).toContain(copy.viewer.exitThanks);
    expect(exit.textContent).toContain(fill(copy.viewer.exitCount, { n: v.artworks.length }));
    expect(m.q('[data-testid="zoom-caption"]')).toBeNull();
    click(byText(exit, copy.viewer.restart));
    expect(m.stop()).toBe(artworkStops(v)[0]?.id);
    for (let i = 0; i < artworkStops(v).length; i++) m.next();
    click(byText(m.q('[data-testid="visit2d-exit"]')!, copy.closed.home));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('좌우 키로 넘기고, 누르고 있는 반복·입력 칸의 키는 넘기지 않는다', () => {
    const v = view();
    const m = mount({ view: v });
    const order = artworkStops(v).map(s => s.id);
    key('ArrowRight');
    expect(m.stop()).toBe(order[1]);
    key('ArrowRight', { repeat: true });
    expect(m.stop()).toBe(order[1]);
    key('ArrowLeft');
    expect(m.stop()).toBe(order[0]);
    const input = document.createElement('input');
    host!.appendChild(input);
    key('ArrowRight', {}, input);
    expect(m.stop()).toBe(order[0]);
  });

  it('밀기: 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전, 조금 움직이면 그대로', () => {
    const v = view();
    const m = mount({ view: v });
    const order = artworkStops(v).map(s => s.id);
    const wall = m.q('main')!;
    pointer(wall, 'pointerdown', 300);
    pointer(wall, 'pointerup', 180);
    expect(m.stop()).toBe(order[1]);
    pointer(wall, 'pointerdown', 300);
    pointer(wall, 'pointerup', 290);
    expect(m.stop()).toBe(order[1]);
    pointer(wall, 'pointerdown', 100);
    pointer(wall, 'pointerup', 260);
    expect(m.stop()).toBe(order[0]);
  });

  it('3D에서 넘어오면 보던 정지 지점에서 시작하고, 지금 정지 지점을 알린다', () => {
    const v = view();
    const stops = artworkStops(v);
    const onStop = vi.fn();
    const m = mount({ view: v, startStopId: stops[5]!.id, onStop });
    expect(m.stop()).toBe(stops[5]!.id);
    expect(onStop).toHaveBeenLastCalledWith(stops[5]!.id);
    m.next();
    expect(onStop).toHaveBeenLastCalledWith(stops[6]!.id);
    // 작품이 아닌 곳(광장)에서 넘어오면 첫 작품부터
    act(() => root?.unmount());
    root = null;
    const n = mount({ view: v, startStopId: v.layout.stops[0]!.id });
    expect(n.stop()).toBe(stops[0]!.id);
  });

  it('배치가 바뀌어도(바뀜 확인) 보던 작품을 이어 본다', () => {
    const m = mount({ view: view([4, 3]) });
    m.next();
    const watching = testArtworkId(0, 1);
    const changed = view([5, 3]);
    m.render({ view: changed });
    const same = changed.layout.stops.find(s => s.artworkId === watching)!;
    expect(m.stop()).toBe(same.id);
  });
});

describe('2D 대체 화면 작품 갈래', () => {
  it('그림: 3D 벽 비율 액자에 벽용 그림(받는 동안 썸네일), 위 줄에 전시 이름·전시실 · 번호', () => {
    const v = view();
    const m = mount({ view: v });
    expect(m.kind()).toBe('image');
    const imgs = Array.from(m.q('[data-testid="visit2d-frame"]')!.querySelectorAll('img'));
    const asset = testAssetId(0, 0);
    expect(imgs.map(i => i.getAttribute('src'))).toEqual([
      mediaPath(v.exhibition.id, asset, { name: 'thumb', ext: 'webp' }),
      mediaPath(v.exhibition.id, asset, { name: 'wall', ext: 'webp' }),
    ]);
    expect(m.stage().textContent).toContain(v.exhibition.title);
    expect(m.q('[data-testid="visit2d-place"]')?.textContent).toBe(
      fill(copy.viewer.stopArtwork, { room: v.rooms[0]!.title, index: 1, count: 4 }),
    );
    // 함께 관람 사람 수는 없다
    expect(m.q('[data-testid="live-count"]')).toBeNull();
    expect(m.q('[data-testid="zoom-caption"]')?.textContent).toContain(v.artworks[0]!.title);
  });

  it('글: HTML 종이 카드(제목·본문·작가)', () => {
    const v = view();
    const m = mount({ view: v });
    for (let i = 0; i < 3; i++) m.next();
    expect(m.kind()).toBe('text');
    const card = m.q('[data-testid="visit2d-text"]')!;
    const text = v.artworks.find(a => a.id === testArtworkId(0, 3))!;
    expect(card.textContent).toContain(text.title);
    expect(card.textContent).toContain(text.textBody);
    expect(card.textContent).toContain(text.author);
    expect(card.style.fontSize).toMatch(/^\d+px$/);
    expect(m.q('[data-testid="visit2d-frame"]')).toBeNull();
  });

  it('소리: 명판 + 재생(소리 작품 곡) · 다시 누르면 멈춤 · 넘기면 멈춤', async () => {
    const v = view();
    const m = mount({ view: v });
    const at = artworkStops(v).findIndex(s => s.artworkId === AUDIO_ART);
    for (let i = 0; i < at; i++) m.next();
    expect(m.kind()).toBe('audio');
    const plate = m.q('[data-testid="visit2d-audio"]')!;
    expect(plate.textContent).toContain('가상의 노래');
    expect(plate.textContent).toContain(copy.viewer.playSound);
    await act(async () => {
      m.q<HTMLButtonElement>('[data-testid="visit2d-play"]')!.click();
      await Promise.resolve();
    });
    expect(engine.calls).toContain(`art:art:${AUDIO_ART}`);
    expect(m.q('[data-testid="visit2d-play"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(m.q('[data-testid="visit2d-play"]')?.textContent).toContain(copy.viewer.stopSound);
    click(m.q('[data-testid="visit2d-play"]'));
    expect(engine.calls.at(-1)).toBe('stopArt');
    engine.calls.length = 0;
    m.next();
    expect(engine.calls).toContain('stopArt');
  });

  it('배경음악은 지금 작품이 있는 관의 곡(곡 없는 관·출구에서는 끔)', () => {
    engine.unlocked = true;
    const v = view();
    const m = mount({ view: v });
    expect(engine.calls).toContain(`room:${testRoomId(0)}:${BGM_ID}`);
    engine.calls.length = 0;
    for (let i = 0; i < 4; i++) m.next();
    expect(engine.calls).toContain('room:none');
  });
});

describe('2D 대체 화면 둘레', () => {
  it('처음 안내 한 줄은 넘기면 사라진다', () => {
    const m = mount();
    expect(m.q('[data-testid="visit2d-notice"]')?.textContent).toBe(copy.view2d.notice);
    m.next();
    expect(m.q('[data-testid="visit2d-notice"]')).toBeNull();
  });

  it('캡션 닫기 → 작품 설명 보기로 다시 펴고, 다른 작품으로 가면 다시 펴진다', () => {
    const m = mount();
    click(m.q('[data-testid="zoom-close"]'));
    expect(m.q('[data-testid="zoom-caption"]')).toBeNull();
    click(m.q('[data-testid="visit2d-show-caption"]'));
    expect(m.q('[data-testid="zoom-caption"]')).not.toBeNull();
    click(m.q('[data-testid="zoom-close"]'));
    m.next();
    expect(m.q('[data-testid="zoom-caption"]')).not.toBeNull();
  });

  it('소리 단추는 받은 켬/끔을 쓰고 바꾸면 알린다', () => {
    const set = vi.fn();
    const m = mount({ sound: { on: true, set } });
    const btn = m.q('[data-testid="sound-toggle"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    click(btn);
    expect(set).toHaveBeenCalledWith(false);
    m.render({ sound: { on: false, set } });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(engine.calls).toContain('muted:true');
  });

  it('바뀜 띠: 새로 보기를 누르면 알린다', () => {
    const onApplyUpdate = vi.fn();
    const m = mount({ pendingUpdate: true, onApplyUpdate });
    const banner = m.q('[data-testid="update-banner"]')!;
    expect(banner.textContent).toContain(copy.viewer.updated);
    click(byText(banner, copy.viewer.updatedAction));
    expect(onApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it('반응: 학생 경로(서비스가 있음)에서 켰으면 반응 남기기 → 반응 덮개, 덮개가 열린 동안 키로 넘기지 않음', async () => {
    expect(mount().q('[data-testid="zoom-react"]')).toBeNull(); // 서비스 없음(개발 화면)
    act(() => root?.unmount());
    root = null;
    const ctx = makeReactionServices();
    const rt = installReactionRuntime(ctx.services, { storage: memoryOutboxStorage(), triggers: false });
    try {
      const v = view();
      const m = mount({
        view: v,
        wrap: n => <ServicesContext value={ctx.services}>{n}</ServicesContext>,
      });
      click(m.q('[data-testid="zoom-react"]'));
      await act(async () => {
        await Promise.resolve();
      });
      const layer = m.q('[data-testid="reaction-consent"]') ?? m.q('[data-testid="reaction-sheet"]');
      expect(layer).not.toBeNull();
      const before = m.stop();
      key('ArrowRight');
      expect(m.stop()).toBe(before);
    } finally {
      rt.dispose();
    }
  });
});
