import { songGainDb } from '@gallery/core/tour';
import type { ExhibitionView } from '@gallery/core/types';
import { mediaPath } from '@gallery/core/types';
import { useEffect, useRef, useState } from 'react';
import { AudioEngine, type Track } from '../../audio/AudioEngine.ts';

/**
 * 전시실 배경음악(P4-7, G-06, PLAN §8): 캐릭터가 들어간 관의 전시실 곡을 흘리고(관을 옮기면 겹쳐 바꿈),
 * 외관·홀·회랑에서는 줄여 끈다. 켬/끔은 기기에 기억한다(`DeviceStore.soundOn`).
 * 소리 엔진은 앱에 하나 — 잠금 풀기는 사용자 누름 안에서(`입장하기`·화면 첫 누름·`소리` 단추).
 */

let shared: AudioEngine | null = null;

/** 앱 전체 소리 엔진(처음 부를 때 만든다) */
export const audioEngine = (): AudioEngine => (shared ??= new AudioEngine());

/** 누름 안에서 부른다. 이미 풀렸으면 바로 true */
export const unlockAudio = (): Promise<boolean> => audioEngine().unlock();

/** 구역(관 ID) → 그 전시실 배경음악 곡(없으면 null) */
export const roomTrackOf = (view: ExhibitionView, region: string): Track | null => {
  const part = view.layout.parts.find(p => p.partId === region);
  if (!part) return null;
  const room = view.rooms.find(r => r.id === part.roomId);
  const bgm = room?.bgm;
  if (!bgm) return null;
  const v = bgm.asset.variants.find(x => x.name === 'audio') ?? bgm.asset.variants[0];
  if (!v) return null;
  return {
    id: `${room.id}:${bgm.asset.assetId}`,
    url: mediaPath(view.exhibition.id, bgm.asset.assetId, v),
    startMs: bgm.analysis.audibleStartMs,
    gainDb: songGainDb(bgm.analysis.loudnessDb),
  };
};

export interface RoomMusicArgs {
  readonly view: ExhibitionView;
  /** 캐릭터가 있는 구역(외관·회랑·관 ID) */
  readonly region: string;
  /** 관람 중(포스터 뒤에서는 소리 없음) */
  readonly entered: boolean;
  /** `소리` 켬/끔 */
  readonly on: boolean;
}

/** 관람 중 구역에 맞춰 곡을 바꾸고, 첫 누름에서 잠금을 푼다. 화면을 떠나면 곡을 줄여 멈춘다 */
export const useRoomMusic = ({ view, region, entered, on }: RoomMusicArgs): void => {
  const [unlocked, setUnlocked] = useState(false);
  // 잠금 풀기: 입장 누름에서 이미 풀렸으면 바로, 아니면 관람 중 첫 누름·키에서
  useEffect(() => {
    if (!entered) return;
    let alive = true;
    const tryUnlock = (): void => {
      void unlockAudio().then(ok => {
        if (alive && ok) setUnlocked(true);
      });
    };
    if (audioEngine().snapshot().unlocked) setUnlocked(true);
    window.addEventListener('pointerdown', tryUnlock, { once: true });
    window.addEventListener('keydown', tryUnlock, { once: true });
    const back = (): void => {
      if (document.visibilityState === 'visible') void audioEngine().resumeIfNeeded();
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      alive = false;
      window.removeEventListener('pointerdown', tryUnlock);
      window.removeEventListener('keydown', tryUnlock);
      document.removeEventListener('visibilitychange', back);
    };
  }, [entered]);
  useEffect(() => {
    if (entered) audioEngine().setMuted(!on);
  }, [entered, on]);
  const track = entered && unlocked ? roomTrackOf(view, region) : null;
  const trackId = track?.id ?? null;
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    if (!entered || !unlocked) return;
    audioEngine().playRoom(trackRef.current);
  }, [entered, unlocked, trackId]);
  // 화면을 떠나면 곡을 줄여 멈춘다
  useEffect(() => () => audioEngine().playRoom(null), []);
};
