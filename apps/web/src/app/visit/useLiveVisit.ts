import type { CharacterId, Layout, Pose } from '@gallery/core/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserLiveDeps, createLiveChannel, type LiveJumpChannel } from '../../adapters/live/socket.ts';
import type { LiveStatus } from '../../ports/index.ts';
import { PeerBuffer } from '../../viewer/live/peerBuffer.ts';
import { activeProbe } from '../perf/visitProbe.ts';

/**
 * 함께 관람 연결(ADR-057, R-6): 전시 웹소켓 하나에 들어가 받은 위치를 보간 버퍼에 넣고, 내 자리를 보낸다.
 * 토큰이 없거나 들어오기 전(포스터)이면 잇지 않는다. 끊기면 통로가 스스로 다시 잇고, 그동안 혼자 관람은 그대로.
 * 받은 메시지마다 다시 그리기를 깨운다 — 깨우는 함수는 Canvas 안 쪽이 `wake`에 넣는다.
 * 내 점프가 뜨는 순간 `sendJump`(걷기 화면 `onJump`)로 한 번 알리고, 남의 `jump`는 버퍼가 받아 포물선으로 재생한다(PRD_V2 W-05).
 */
export interface LiveVisit {
  readonly buffer: PeerBuffer;
  /** 다른 사람 수(나 빼고) */
  readonly count: number;
  readonly status: LiveStatus;
  readonly sendPose: (pose: Pose) => void;
  /** 내 점프 시작(걷기 엔진 `jump` 사건마다 한 번) — 판 2 연결일 때만 나간다 */
  readonly sendJump: () => void;
  /** 메시지가 오면 부를 다시 그리기(Canvas 안에서 채움) */
  readonly wake: { current: () => void };
}

export interface LiveVisitArgs {
  readonly code: string;
  readonly token: string | null;
  readonly character: CharacterId;
  readonly layout: Layout;
  readonly enabled: boolean;
  /** 들어가는 역할(기본 방문자). 교사 3D 미리 보기는 `teacher` — 토큰은 교사 세션, 캐릭터는 `teacher-*`(PRD 15.8) */
  readonly as?: 'visitor' | 'teacher' | undefined;
}

export const useLiveVisit = ({
  code,
  token,
  character,
  layout,
  enabled,
  as = 'visitor',
}: LiveVisitArgs): LiveVisit => {
  const buffer = useMemo(() => new PeerBuffer(), []);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<LiveStatus>('off');
  const channel = useRef<LiveJumpChannel | null>(null);
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
        as,
        character,
        pose: { x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2], yaw: spawn.yaw, move: 0 },
      },
      {
        onMessage: (msg, at) => {
          buffer.apply(msg, at);
          setCount(buffer.size);
          wake.current();
        },
        onStatus: s => {
          setStatus(s);
          activeProbe()?.live(s === 'live' ? 'live' : s === 'off' || s === 'connecting' ? 'off' : 'other');
        },
        onBytes: n => activeProbe()?.liveMessage(n, buffer.size),
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
  }, [enabled, token, code, character, layout, buffer, as]);

  const sendPose = useCallback((pose: Pose) => channel.current?.sendPose(pose), []);
  const sendJump = useCallback(() => channel.current?.sendJump(), []);
  return { buffer, count, status, sendPose, sendJump, wake };
};
