import { type BubbleContent, bubbleAllowed, bubbleReadyAt, recordBubble } from '@gallery/core/live';
import type { BubbleSettings, CharacterId, Layout, Pose } from '@gallery/core/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserLiveDeps, createLiveChannel, type LiveJumpChannel } from '../../adapters/live/socket.ts';
import type { LiveStatus } from '../../ports/index.ts';
import { BUBBLE_ME, BubbleBoard } from '../../viewer/live/bubbleBoard.ts';
import { PeerBuffer } from '../../viewer/live/peerBuffer.ts';
import { activeProbe } from '../perf/visitProbe.ts';

/**
 * 함께 관람 연결(ADR-057, R-6): 전시 웹소켓 하나에 들어가 받은 위치를 보간 버퍼에 넣고, 내 자리를 보낸다.
 * 토큰이 없거나 들어오기 전(포스터)이면 잇지 않는다. 끊기면 통로가 스스로 다시 잇고, 그동안 혼자 관람은 그대로.
 * 받은 메시지마다 다시 그리기를 깨운다 — 깨우는 함수는 Canvas 안 쪽이 `wake`에 넣는다.
 * 내 점프가 뜨는 순간 `sendJump`(걷기 화면 `onJump`)로 한 번 알리고, 남의 `jump`는 버퍼가 받아 포물선으로 재생한다(PRD_V2 W-05).
 * 말풍선(PRD_V2 W-02): 받은 `bubble`은 판에 올리고(떠난 사람 것은 내림), 교사 설정은 welcome·`cfg`로 받는다(판 1 서버면 null —
 * 말풍선 없음). `sendBubble`은 설정·속도 제한(서버와 같은 `domain/live/bubble.ts`)을 먼저 보고, 보냈으면 내 머리 위에도 띄운다.
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
  /** 머리 위 말풍선 판(나·다른 사람) */
  readonly bubbles: BubbleBoard;
  /** 이 전시의 말풍선 설정(판 2 서버에 이어졌을 때만, 아니면 null = 서랍을 보이지 않음) */
  readonly bubbleSettings: BubbleSettings | null;
  /**
   * 말풍선 하나 보내기: 'sent'(내 머리 위에도 띄움) · 'wait'(속도 제한 — `bubbleWaitMs`만큼 뒤에) · 'off'(설정이 꺼졌거나
   * 짧은 글이 허용되지 않음, 이어지지 않음). 글은 부른 쪽이 `prepareBubbleText`로 다듬어 넘긴다
   */
  readonly sendBubble: (b: BubbleContent) => 'sent' | 'wait' | 'off';
  /** 지금부터 다시 보낼 수 있을 때까지 남은 ms(0 = 지금) */
  readonly bubbleWaitMs: () => number;
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
  const bubbles = useMemo(() => new BubbleBoard(), []);
  const [bubbleSettings, setBubbleSettings] = useState<BubbleSettings | null>(null);
  const settingsRef = useRef<BubbleSettings | null>(null);
  settingsRef.current = bubbleSettings;
  /** 내가 보낸 시각(ms, 속도 제한) */
  const sent = useRef<number[]>([]);

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
          if (msg.t === 'welcome') {
            bubbles.clear();
            setBubbleSettings(msg.bubbles ?? null);
          } else if (msg.t === 'cfg') {
            setBubbleSettings(msg.bubbles);
            // 수업 중 끄면 떠 있던 것도 거둔다
            if (!msg.bubbles.enabled) bubbles.clear();
          } else if (msg.t === 'bubble') bubbles.put(msg.sid, msg.b, at);
          else if (msg.t === 'leave') bubbles.remove(msg.sid);
          else if (msg.t === 'bye') {
            bubbles.clear();
            setBubbleSettings(null);
          }
          wake.current();
        },
        onStatus: s => {
          setStatus(s);
          // 끊기면 다시 이은 welcome이 설정을 다시 알릴 때까지 서랍을 닫아 둔다
          if (s !== 'live') setBubbleSettings(null);
          activeProbe()?.live(s === 'live' ? 'live' : s === 'off' || s === 'connecting' ? 'off' : 'other');
        },
        onBytes: n => activeProbe()?.liveMessage(n, buffer.size),
      },
    );
    return () => {
      ch.leave();
      channel.current = null;
      buffer.clear();
      bubbles.clear();
      setCount(0);
      setStatus('off');
      setBubbleSettings(null);
      wake.current();
    };
  }, [enabled, token, code, character, layout, buffer, bubbles, as]);

  const sendPose = useCallback((pose: Pose) => channel.current?.sendPose(pose), []);
  const sendJump = useCallback(() => channel.current?.sendJump(), []);
  const sendBubble = useCallback(
    (b: BubbleContent): 'sent' | 'wait' | 'off' => {
      const cfg = settingsRef.current;
      if (!cfg?.enabled || (b.k === 'x' && !cfg.text)) return 'off';
      const now = Date.now();
      if (!bubbleAllowed(sent.current, now)) return 'wait';
      if (!channel.current?.sendBubble(b)) return 'off';
      recordBubble(sent.current, now);
      bubbles.put(BUBBLE_ME, b, now);
      wake.current();
      return 'sent';
    },
    [bubbles],
  );
  const bubbleWaitMs = useCallback(() => {
    const now = Date.now();
    return Math.max(0, bubbleReadyAt(sent.current, now) - now);
  }, []);
  return {
    buffer,
    count,
    status,
    sendPose,
    sendJump,
    wake,
    bubbles,
    bubbleSettings,
    sendBubble,
    bubbleWaitMs,
  };
};
