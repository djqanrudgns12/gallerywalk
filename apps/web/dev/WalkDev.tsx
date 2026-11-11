import { copy, fill } from '@gallery/core/copy';
import { config } from '@gallery/core/config';
import { standable } from '@gallery/core/layout';
import {
  DEFAULT_MOOD,
  MOOD_IDS,
  type MoodId,
  templateGeometry,
  templateMoods,
} from '@gallery/core/templates';
import type { CharacterId, Layout } from '@gallery/core/types';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import '../src/ui/tokens.css';
import '../src/ui/themes/modern-history.css';
import { templateAssets } from '../src/viewer/scene/templateAssets.ts';
import { PeerBuffer, visibleMaxFor } from '../src/viewer/live/peerBuffer.ts';
import {
  dprCap,
  Gestures,
  peerLabel,
  tapFloor,
  useMapOpen,
  WalkOverlay,
  walkStyles as s,
} from '../src/app/visit/walkUi.tsx';
import { facadeTitle } from '../src/viewer/scene/FacadeSign.tsx';
import type { DimHolder } from '../src/viewer/scene/materials.ts';
import { VisitorScene } from '../src/viewer/VisitorScene.tsx';
import { useWalkKeyboard } from '../src/viewer/walk/input.ts';
import { useWalk } from '../src/viewer/walk/walkStore.ts';
import { startFakePeers } from './fakePeers.ts';
import { buildTestExhibition, type TestExhibition } from './testExhibition.ts';

/**
 * `/dev/walk` — 자유 관람(ADR-057, R-1) 확인 화면. 광장에서 시작해 계단을 올라 전시관에 들어가 걷는다.
 * 확인할 것: 조이스틱·WASD·바닥 누르기로 걷기, 벽 통과 없음, 계단 높이, "다음 작품으로" 안내 걷기와 작품 앞 크게 보기,
 * 작품 누르면 크게 보기, 멈추면 다시 그리기 0(`?hud=1`), 휴대폰·태블릿·데스크톱 반응형.
 * `?rooms=n`(1~17), `?character=student-f` 등, `?stick=1`(데스크톱에서도 조이스틱), `?mood=a|b|c`(실내 분위기 시안).
 * 외관·설비·캐릭터는 R-3·R-4 결과가 오기 전까지 임시 모양이다.
 */

// `?mood=a|b|c`: 실내 분위기 시안(R-9a) 비교 — 없으면 기본
const moodParam = new URLSearchParams(window.location.search).get('mood');
const MOOD: MoodId = (MOOD_IDS as readonly string[]).includes(moodParam ?? '')
  ? (moodParam as MoodId)
  : DEFAULT_MOOD;
const LOOK = templateMoods['modern-history'][MOOD];
const ASSETS = templateAssets['modern-history'];
// e2e·수동 확인용: 걷기 상태를 창에서 읽고 부를 수 있게(개발 화면에만)
Object.assign(window, { __walk: useWalk });
const params = new URLSearchParams(window.location.search);
/** 개발 화면은 높음 단계(`?tier=MEDIUM|LOW`로 바꿔 봄) */
const TIER = (['HIGH', 'MEDIUM', 'LOW'] as const).find(t => t === params.get('tier')) ?? 'HIGH';
const CHARACTERS: readonly CharacterId[] = ['student-m', 'student-f', 'teacher-m', 'teacher-f'];
const character: CharacterId = CHARACTERS.find(c => c === params.get('character')) ?? 'student-m';
const touch = typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || params.has('stick'));
useMapOpen.setState({ open: params.has('map') });

/** 함께 관람(가짜 관람객 `?peers=n`): 받은 메시지를 보간 버퍼에, 사람 수는 화면에. 메시지가 오면 다시 그리기를 깨운다 */
const peerBuffer = new PeerBuffer();
const useLive = create<{ count: number }>(() => ({ count: 0 }));
const FAKE_PEERS = Math.max(0, Math.min(80, Number.parseInt(params.get('peers') ?? '0', 10) || 0));

const LiveDriver = ({ layout }: { layout: Layout }) => {
  const invalidate = useThree(st => st.invalidate);
  useEffect(() => {
    if (FAKE_PEERS === 0) return;
    const stop = startFakePeers(layout, FAKE_PEERS, (msg, at) => {
      peerBuffer.apply(msg, at);
      if (useLive.getState().count !== peerBuffer.size) useLive.setState({ count: peerBuffer.size });
      invalidate();
    });
    return () => {
      stop();
      peerBuffer.clear();
    };
  }, [layout, invalidate]);
  return null;
};

/** 캔버스 안: 공용 3D 장면(`VisitorScene`)에 시험 전시·가짜 관람객을 넣는다 */
const Scene = ({
  exhibition,
  holders,
}: {
  exhibition: TestExhibition;
  holders: Readonly<Record<string, DimHolder>>;
}) => {
  const invalidate = useThree(st => st.invalidate);
  const size = useThree(st => st.size);
  const { layout, artworks } = exhibition;
  const placeOf = useCallback(
    (r: string): string => {
      if (r === 'exterior') return fill(copy.viewer.stopExterior, { title: facadeTitle(exhibition.title) });
      if (r === 'spine') return exhibition.title;
      const roomId = r.split(':')[0] ?? '';
      return exhibition.roomTitles.get(roomId) ?? '';
    },
    [exhibition],
  );
  const peers = useMemo(
    () =>
      FAKE_PEERS === 0
        ? null
        : {
            sample: () => peerBuffer.sample(Date.now()),
            busy: () => peerBuffer.busy(Date.now()),
            labelOf: peerLabel,
            maxFull: visibleMaxFor(Math.min(size.width, size.height), navigator.maxTouchPoints > 0),
            invalidate,
          },
    [invalidate, size.width, size.height],
  );
  return (
    <>
      <VisitorScene
        layout={layout}
        look={LOOK}
        modulesUrl={ASSETS.modules}
        fixturesUrl={ASSETS.fixtures}
        title={exhibition.title}
        artworks={artworks}
        holders={holders}
        character={character}
        tier={TIER}
        placeOf={placeOf}
        peers={peers}
        extra={modules =>
          modules && !modules.has(templateGeometry['modern-history'].modules.portico) ? (
            <ExteriorStandIn layout={layout} />
          ) : null
        }
      />
      <LiveDriver layout={layout} />
    </>
  );
};

/**
 * 외관 조각(R-3)이 아직 core.glb에 없을 때만: 계단·현관·날개 벽 자리를 밝은 돌색 덩어리로(위치·높이 확인용, 운영에는 없음).
 */
const ExteriorStandIn = ({ layout }: { layout: Layout }) => {
  const g = templateGeometry['modern-history'];
  const e = g.exterior;
  const x = layout.exterior;
  const zf = x.facadeZ;
  const zPF = zf - e.porticoD;
  const rise = -x.groundY;
  const steps = Array.from({ length: e.steps }, (_, i) => i);
  const stone = '#e9e2d4';
  const wing = x.halfWidth - e.porticoW / 2;
  return (
    <group>
      {/* 현관 바닥(기단) */}
      <mesh position={[0, -rise / 2, zf - e.porticoD / 2]}>
        <boxGeometry args={[e.porticoW, rise, e.porticoD]} />
        <meshStandardMaterial color={stone} roughness={0.85} />
      </mesh>
      {/* 계단 */}
      {steps.map(i => (
        <mesh key={i} position={[0, -rise + (i + 0.5) * e.stepRiseM, zPF - (e.steps - i - 0.5) * e.stepRunM]}>
          <boxGeometry args={[e.porticoW, e.stepRiseM, e.stepRunM]} />
          <meshStandardMaterial color={i % 2 ? '#e3dbcb' : stone} roughness={0.85} />
        </mesh>
      ))}
      {/* 기둥 */}
      {e.columnXs
        .flatMap(cx => [cx, -cx])
        .map(cx => (
          <mesh key={cx} position={[cx, 2.5, zPF + e.columnInsetM]}>
            <cylinderGeometry args={[e.columnDiameterM / 2, e.columnDiameterM / 2, 5, 20]} />
            <meshStandardMaterial color="#f1ece2" roughness={0.6} />
          </mesh>
        ))}
      {/* 엔타블러처·박공 */}
      <mesh position={[0, 5.4, zPF + e.porticoD / 2 - 0.2]}>
        <boxGeometry args={[e.porticoW + 0.6, 0.9, e.porticoD + 0.4]} />
        <meshStandardMaterial color="#efe8da" roughness={0.7} />
      </mesh>
      {/* 현관 뒷벽(정문 둘레) */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * (e.porticoW / 4 + 0.5), 2.5, zf + 0.15]}>
          <boxGeometry args={[e.porticoW / 2 - 1, 5, 0.3]} />
          <meshStandardMaterial color="#e6dfd0" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 4.2, zf + 0.15]}>
        <boxGeometry args={[2, 2.6, 0.3]} />
        <meshStandardMaterial color="#e6dfd0" roughness={0.8} />
      </mesh>
      {/* 날개 벽 */}
      {[-1, 1].map(side => (
        <mesh key={`w${side}`} position={[side * (e.porticoW / 2 + wing / 2), x.groundY + 3.1, zf + 0.2]}>
          <boxGeometry args={[wing, 6.2, 0.4]} />
          <meshStandardMaterial color="#ddd4c2" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
};

export const WalkDev = () => {
  const exhibition = useMemo(buildTestExhibition, []);
  const holders = useMemo<Record<string, DimHolder>>(
    () => Object.fromEntries(exhibition.artworks.map(a => [a.id, { value: 1 }])),
    [exhibition],
  );
  // e2e: 그 자리에 설 수 있는가(벽 통과 확인)
  Object.assign(window, {
    __walkCheck: (x: number, z: number): boolean => standable(exhibition.layout.walk, [x, z]),
  });
  const dpr = useMemo(dprCap, []);
  useWalkKeyboard();
  return (
    <div className={s.stage} data-theme="modern-history">
      <Gestures>
        <Canvas
          frameloop="demand"
          dpr={dpr}
          gl={{
            antialias: dpr < config().MSAA_MAX_DPR,
            alpha: false,
            stencil: false,
            powerPreference: 'high-performance',
          }}
          camera={{ fov: config().VFOV_DEG, near: 0.05, far: 120, position: [0, 1, -30] }}
          onPointerMissed={tapFloor}
        >
          <Scene exhibition={exhibition} holders={holders} />
        </Canvas>
      </Gestures>
      <Overlay exhibition={exhibition} />
    </div>
  );
};

/** DOM 층(학생 관람과 같은 `WalkOverlay`) — 함께 보는 사람 수는 가짜 관람객 수 + 나 */
const Overlay = ({ exhibition }: { exhibition: TestExhibition }) => {
  const n = useLive(st => st.count);
  return (
    <WalkOverlay
      title={facadeTitle(exhibition.title)}
      layout={exhibition.layout}
      artworks={exhibition.artworks}
      liveCount={n > 0 ? n + 1 : 0}
      touch={touch}
      hud={params.has('hud')}
    />
  );
};
