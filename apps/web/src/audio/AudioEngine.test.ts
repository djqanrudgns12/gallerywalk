import { config } from '@gallery/core/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, type Track } from './AudioEngine.ts';

/**
 * 소리 엔진(G-06): 가짜 AudioContext(경사는 마지막 값으로 바로 감)와 재생 상태를 기억하는 미디어 요소로
 * 방을 나갔다 돌아오기·두 번째 잠금 풀기를 본다. 곡 주소는 가상의 것.
 */

class FakeParam {
  value = 0;
  cancelScheduledValues(): void {}
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
}

class FakeContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {};
  createGain() {
    return { gain: new FakeParam(), connect: () => undefined };
  }
  createMediaElementSource() {
    return { connect: () => undefined };
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

const playing = new WeakSet<HTMLMediaElement>();
const A: Track = { id: 'room-a', url: '/assets/g/m/a.mp3' };
const B: Track = { id: 'room-b', url: '/assets/g/m/b.mp3' };
const fadeMs = config().BGM_CROSSFADE_SEC * 1000 + 100;

let engine: AudioEngine;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeContext);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playing.add(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
    return !playing.has(this);
  });
  engine = new AudioEngine();
});
afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 들린다고 볼 이득(등전력 곡선의 끝 cos(π/2)는 0이 아니라 아주 작은 수) */
const HEARD = 0.01;
/** 지금 그 곡을 내는 요소(들리게 켜져 있고 재생 중) */
const audible = (id: string) =>
  engine.snapshot().slots.filter(s => s.id === id && s.gain > HEARD && !s.paused).length;

describe('AudioEngine', () => {
  it('전시실을 나가 곡이 멈춘 뒤 같은 전시실로 돌아오면 다시 들린다', async () => {
    await engine.unlock();
    engine.playRoom(A);
    expect(audible(A.id)).toBe(1);
    engine.playRoom(null);
    await vi.advanceTimersByTimeAsync(fadeMs);
    expect(engine.snapshot().slots.every(s => s.paused)).toBe(true);
    engine.playRoom(A);
    expect(audible(A.id)).toBe(1);
  });

  it('줄여 멈추는 도중 같은 전시실로 돌아오면 그 자리에서 다시 키우고 멈추지 않는다', async () => {
    await engine.unlock();
    engine.playRoom(A);
    engine.playRoom(null);
    await vi.advanceTimersByTimeAsync(fadeMs / 2);
    engine.playRoom(A);
    await vi.advanceTimersByTimeAsync(fadeMs);
    expect(audible(A.id)).toBe(1);
    // 다른 곡으로 넘어가면 앞 곡 요소는 쉰다
    engine.playRoom(B);
    await vi.advanceTimersByTimeAsync(fadeMs);
    expect(audible(B.id)).toBe(1);
    expect(engine.snapshot().slots.filter(s => !s.paused)).toHaveLength(1);
  });

  it('이미 풀린 뒤 다시 잠금 풀기(키 입력 등)를 불러도 흐르던 곡을 멈추지 않는다', async () => {
    await engine.unlock();
    engine.playRoom(A);
    expect(audible(A.id)).toBe(1);
    expect(await engine.unlock()).toBe(true);
    expect(audible(A.id)).toBe(1);
  });
});
