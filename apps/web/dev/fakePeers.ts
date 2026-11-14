import { config } from '@gallery/core/config';
import {
  type CharacterId,
  type Layout,
  type LiveServerMessage,
  type Pose,
  STUDENT_FEMALE_IDS,
  STUDENT_MALE_IDS,
} from '@gallery/core/types';
import { buildGuideMap, pathBetween, standSpot } from '../src/viewer/walk/guide.ts';
import { Walker } from '../src/viewer/walk/walker.ts';

/**
 * `/dev/walk?peers=n`: 서버 없이 가짜 관람객 n명이 정지 지점 사이를 걸어 다니며 서버 방송과 같은 메시지를 만든다
 * (R-6 끝 조건 "30명 가짜 관람객에서 태블릿 예산 안"을 재는 용도). 별명은 가상의 것.
 * 캐릭터는 12종(학생 남·여 번갈아 10 + 교사 여·남)이 섞인다(M4-9 — 몸 틀 넷이 모두 나와 몸 묶음 예산을 끝까지 잰다).
 */

const KINDS: readonly CharacterId[] = [
  ...STUDENT_MALE_IDS.flatMap((m, i) => [m, STUDENT_FEMALE_IDS[i] ?? 'student-f-01']),
  'teacher-f',
  'teacher-m',
];
const NAMES = [
  '하늘고래',
  '달빛소나무',
  '바람개비',
  '초록연필',
  '푸른솔',
  '별바라기',
  '봄바람',
  '은하수',
  '아리랑모둠',
];

export const startFakePeers = (
  layout: Layout,
  n: number,
  emit: (msg: LiveServerMessage, receivedAt: number) => void,
  /** 처음 자리에 서 있기만 함(`?peerStill=1` — 그리기 수를 흔들림 없이 잴 때) */
  opts: { readonly still?: boolean } = {},
): (() => void) => {
  const map = buildGuideMap(layout);
  let seed = 12345;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stops = layout.stops;
  const peers = Array.from({ length: n }, (_, i) => {
    const sid = `fake${String(i).padStart(4, '0')}`;
    const start = stops[Math.floor(rnd() * stops.length)]!;
    const spot = standSpot(layout, start, 1.6);
    const w = new Walker(layout.walk, { x: spot.at[0], z: spot.at[1], yaw: spot.yaw });
    const go = (): void => {
      const s = stops[Math.floor(rnd() * stops.length)]!;
      const to = standSpot(layout, s, 1.6);
      w.follow(pathBetween(map, [w.pose.x, w.pose.z], to.at), to.yaw, () => {
        pause = 1 + Math.floor(rnd() * 15);
      });
    };
    let pause = Math.floor(rnd() * 10);
    const character = KINDS[i % KINDS.length]!;
    return {
      sid,
      character,
      nickname: character.startsWith('teacher')
        ? '선생님'
        : `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`,
      walker: w,
      tick: (): void => {
        if (!w.guiding) {
          if (pause > 0) pause--;
          else go();
        }
      },
    };
  });
  const poseOf = (w: Walker): Pose => ({
    x: w.pose.x,
    y: w.pose.y,
    z: w.pose.z,
    yaw: w.pose.yaw,
    move: w.pose.move,
  });
  const t0 = Date.now();
  emit(
    {
      t: 'welcome',
      you: 'me000000',
      nickname: '나',
      peers: peers.map(p => ({
        sid: p.sid,
        nickname: p.nickname,
        role: p.character.startsWith('teacher') ? 'teacher' : 'visitor',
        character: p.character,
        pose: poseOf(p.walker),
      })),
      at: t0,
    },
    t0,
  );
  const dt = 1 / config().LIVE_BROADCAST_HZ;
  const still = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };
  const timer = window.setInterval(() => {
    // 서로 겹치지 않게: 각자 둘레 1.5m 안의 다른 가짜 관람객을 피한다(실제 관람객도 각자 기기에서 같은 일을 함)
    const at = peers.map(p => [p.walker.pose.x, p.walker.pose.z] as [number, number]);
    for (const [i, p] of peers.entries()) {
      if (opts.still) continue;
      p.walker.setCrowd(at.filter((q, j) => j !== i && Math.hypot(q[0] - at[i]![0], q[1] - at[i]![1]) < 1.5));
      p.tick();
      // 방송 간격을 작은 걸음으로 나눠 걷는다(벽 미끄러짐이 한 번에 크게 튀지 않게)
      for (let k = 0; k < 4; k++) p.walker.step(dt / 4, still);
    }
    const now = Date.now();
    emit({ t: 'peers', at: now, poses: peers.map(p => ({ sid: p.sid, pose: poseOf(p.walker) })) }, now);
  }, 1000 * dt);
  return () => window.clearInterval(timer);
};
