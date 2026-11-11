import type { CharacterId, Layout, Pose } from '@gallery/core/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserLiveDeps, createLiveChannel } from '../../adapters/live/socket.ts';
import type { LiveChannel, LiveStatus } from '../../ports/index.ts';
import { PeerBuffer } from '../../viewer/live/peerBuffer.ts';

/**
 * 함께 관람 연결(ADR-057, R-6): 전시 웹소켓 하나에 들어가 받은 위치를 보간 버퍼에 넣고, 내 자리를 보낸다.
 * 토큰이 없거나 들어오기 전(포스터)이면 잇지 않는다. 끊기면 통로가 스스로 다시 잇고, 그동안 혼자 관람은 그대로.
 * 받은 메시지마다 다시 그리기를 깨운다 — 깨우는 함수는 Canvas 안 쪽이 `wake`에 넣는다.
 */
export interface LiveVisit {
  readonly buffer: PeerBuffer;
  /** 다른 사람 수(나 빼고) */
  readonly count: number;
  readonly status: LiveStatus;
  readonly sendPose: (pose: Pose) => void;
  /** 메시지가 오면 부를 다시 그리기(Canvas 안에서 채움) */
  readonly wake: { current: () => void };
}

export interface LiveVisitArgs {
  readonly code: string;
  readonly token: string | null;
  readonly character: CharacterId;
  readonly layout: Layout;
  readonly enabled: boolean;
}

export const useLiveVisit = ({ code, token, character, layout, enabled }: LiveVisitArgs): LiveVisit => {
  const buffer = useMemo(() => new PeerBuffer(), []);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<LiveStatus>('off');
  const channel = useRef<LiveChannel | null>(null);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled || !token) return;
    const ch = createLiveChannel(browserLiveDeps());
    channel.current = ch;
    const spawn = layout.walk.spawn;
    ch.join(
      {
        code,
        token,
        as: 'visitor',
        character,
        pose: { x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2], yaw: spawn.yaw, move: 0 },
      },
      {
        onMessage: (msg, at) => {
          buffer.apply(msg, at);
          setCount(buffer.size);
          wake.current();
        },
        onStatus: s => setStatus(s),
      },
    );
    return () => {
      ch.leave();
      channel.current = null;
      buffer.clear();
      setCount(0);
      setStatus('off');
      wake.current();
    };
  }, [enabled, token, code, character, layout, buffer]);

  const sendPose = useCallback((pose: Pose) => channel.current?.sendPose(pose), []);
  return { buffer, count, status, sendPose, wake };
};
