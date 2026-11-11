import { useEffect, useMemo, useState } from 'react';
import { AudioEngine, type AudioSnapshot, type Track } from '../src/audio/AudioEngine.ts';
import s from './AudioDev.module.css';

/**
 * `/dev/audio` — P1-6 소리 관문. 실기기(iPad 무음 스위치 켬/끔, iPhone, 갤럭시탭, Android 폰)에서 확인한다(관문 G1).
 * 순서: 입장(잠금 풀기) → 방 1 → 방 2(교차 페이드 1.5초) → 작품 소리(배경 낮추기) → 소리 끄기 → 화면 잠금 뒤 복귀.
 * 시험음은 기기에서 만든 WAV라 외부 파일이 없다.
 */

const tone = (freq: number, seconds: number): string => {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  const text = (o: number, str: string) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 9000), true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

export const AudioDev = () => {
  const engine = useMemo(() => new AudioEngine(), []);
  const tracks = useMemo(
    () => ({
      room1: { id: 'room1', url: tone(440, 8) } satisfies Track,
      room2: { id: 'room2', url: tone(660, 8), gainDb: -3 } satisfies Track,
      artwork: { id: 'artwork', url: tone(880, 2) } satisfies Track,
    }),
    [],
  );
  const [snap, setSnap] = useState<AudioSnapshot>(() => engine.snapshot());
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    (window as unknown as { __gwAudio?: AudioEngine }).__gwAudio = engine;
    const timer = window.setInterval(() => setSnap(engine.snapshot()), 100);
    return () => {
      window.clearInterval(timer);
      engine.dispose();
    };
  }, [engine]);

  return (
    <main className={s.page}>
      <h1>/dev/audio</h1>
      <div className={s.row}>
        <button type="button" data-testid="unlock" onClick={() => void engine.unlock()}>
          입장(잠금 풀기)
        </button>
        <button type="button" data-testid="room1" onClick={() => engine.playRoom(tracks.room1)}>
          방 1 (440Hz)
        </button>
        <button type="button" data-testid="room2" onClick={() => engine.playRoom(tracks.room2)}>
          방 2 (660Hz, −3dB)
        </button>
        <button type="button" data-testid="no-room" onClick={() => engine.playRoom(null)}>
          배경음악 없는 방
        </button>
        <button type="button" data-testid="artwork" onClick={() => engine.playArtwork(tracks.artwork)}>
          작품 소리 (880Hz 2초)
        </button>
        <button
          type="button"
          data-testid="mute"
          onClick={() => {
            engine.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? '소리 켜기' : '소리 끄기'}
        </button>
      </div>
      <pre className={s.snap} data-testid="snapshot">
        {JSON.stringify(snap, (_k, v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 2)}
      </pre>
    </main>
  );
};
