import { copy } from '@gallery/core/copy';
import type { TemplateLook } from '@gallery/core/templates';
import type { P2 } from '@gallery/core/layout';
import type { CharacterId, Layout, Pose } from '@gallery/core/types';
import { useThree } from '@react-three/fiber';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BubbleBoard } from './live/bubbleBoard.ts';
import { type BubbleDevice, Bubbles } from './live/Bubbles.tsx';
import { type PeerView } from './live/peerBuffer.ts';
import { Peers } from './live/Peers.tsx';
import { useArtworkHover } from './scene/useArtworkHover.ts';
import { ArtworkFrame } from './scene/ArtworkFrame.tsx';
import { ArtworkLabels, type LabelItem } from './scene/ArtworkLabels.tsx';
import { ExteriorContact } from './scene/ExteriorContact.tsx';
import { labelAwayOf } from './scene/labelAway.ts';
import { FacadeSign } from './scene/FacadeSign.tsx';
import { Docents } from './npc/Docents.tsx';
import { SignsV4 } from './signs/SignsV4.tsx';
import { withoutLegacySigns } from './signs/signAtlasV4.ts';
import { BlockoutModules } from './scene/BlockoutModules.tsx';
import { WallWash } from './scene/WallWash.tsx';
import { Decor } from './scene/Decor.tsx';
import { FixtureModels } from './scene/FixtureModels.tsx';
import type { DimHolder } from './scene/materials.ts';
import { MicroMotion } from './scene/MicroMotion.tsx';
import { vignetteOf } from './scene/microMotion.ts';
import { Sky } from './scene/Sky.tsx';
import { Stage } from './scene/Stage.tsx';
import { ScenePreparation } from './scene/ScenePreparation.tsx';
import { type ModulePlacement, TemplateModules, useTemplateModules } from './scene/TemplateModules.tsx';
import type { ViewerArtwork } from './scene/types.ts';
import { Vignette } from './scene/Vignette.tsx';
import type { Focus, Tier } from './textures/residency.ts';
import type { CardText } from './textures/textCard.ts';
import { useCardTextures } from './textures/useCardTextures.ts';
import { type ArtworkTextureSource, useResidentTextures } from './textures/useResidentTextures.ts';
import { type SignRoom, signItems, type SignKind, type TextArea, visibleSigns } from './signs/signs.ts';
import { SignTexts } from './signs/SignTexts.tsx';
import { buildGuideMap } from './walk/guide.ts';
import { visibleParts } from './walk/visibleParts.ts';
import { type WalkStart, WalkView } from './walk/WalkView.tsx';
import { useWalk } from './walk/walkStore.ts';
import { ZoomDim } from './walk/ZoomDim.tsx';

/**
 * 자유 관람 3D 장면 한 벌(ADR-057): 무대 빛·하늘·템플릿 조각·설비·정면 이름판·명판·액자·캐릭터·다른 관람객.
 * 학생 관람 화면과 개발 화면(`/dev/walk`)이 같은 것을 쓴다. Canvas 안에 넣는다.
 * 액자·명판은 캐릭터 둘레의 관만(`visibleParts`, §6.6) — 멀어진 관은 떼어 놓는다.
 * 연출(V-40): 액자 마우스 올림 빛·크게 볼 때 빛 웅덩이·먼지·빛 흔들림(`MicroMotion`), 가장자리 어둡게(`Vignette`).
 */

export interface VisitorPeers {
  readonly sample: () => readonly PeerView[];
  readonly busy: () => boolean;
  readonly labelOf: (p: PeerView) => { text: string; teacher: boolean };
  readonly maxFull: number;
  readonly invalidate: () => void;
}

/** 머리 위 말풍선(PRD_V2 W-02) — 판과 화면 크기 갈래. 다른 사람 자리는 `peers.sample`을 같이 쓴다 */
export interface VisitorBubbles {
  readonly board: BubbleBoard;
  readonly device: BubbleDevice;
  readonly invalidate: () => void;
}

export interface VisitorSceneProps {
  readonly layout: Layout;
  readonly look: TemplateLook;
  /** 템플릿 조각 glb 주소(실내 `core` + 외관 `exterior`) */
  readonly modulesUrl: string | readonly string[];
  /** 설비 모델 glb 주소(`fixtures`) — 없으면 임시 모형 */
  readonly fixturesUrl?: string | undefined;
  /** 전시명(정면 이름판) */
  readonly title: string;
  readonly artworks: readonly ViewerArtwork[];
  readonly holders: Readonly<Record<string, DimHolder>>;
  readonly character: CharacterId;
  readonly tier: Tier;
  /** 구역(외관·회랑·관 ID) → 위 줄 이름 */
  readonly placeOf: (region: string) => string;
  readonly peers?: VisitorPeers | null;
  readonly bubbles?: VisitorBubbles | null | undefined;
  /** 그림 파일 없는 작품(글·소리)의 카드 글 — 그리는 관의 것만 캔버스로 조판해 건다(§5.7) */
  readonly cards?: ReadonlyMap<string, CardText> | null | undefined;
  /** 작품 그림 상주 관리(§6.5) 입력. 없으면 작품의 `texture`를 그대로(개발 화면의 합성 그림) */
  readonly textures?: ArtworkTextureSource | null | undefined;
  /** 포스터 뒤에서 미리 준비하는 중(첫 인사 손 흔들기를 미룸) */
  readonly paused?: boolean | undefined;
  /** 그린 프레임마다 내 자리(함께 관람 보내기) */
  readonly onPose?: ((pose: Pose) => void) | undefined;
  /** 내 점프가 뜨는 순간(함께 관람에 알림, PRD_V2 W-05) */
  readonly onJump?: (() => void) | undefined;
  /** 캐릭터가 들어간 구역이 바뀜(외관·회랑·관 ID) — 배경음악 등 바깥이 따라간다 */
  readonly onRegion?: ((region: string) => void) | undefined;
  /**
   * 걷기 대신 카메라를 몰 조종기(자동 투어·미리 보기). 있으면 캐릭터와 걷기(`WalkView`)를 그리지 않는다.
   * 받는 함수로 지금 구역을 알려야 그 둘레 관만 붙인다.
   */
  readonly controller?: ((onRegion: (region: string) => void) => ReactNode) | undefined;
  /** 동작 줄이기(PRD 8.4) */
  readonly reducedMotion?: boolean | undefined;
  /** 시작 자리(캔버스를 다시 붙일 때 이어 걷기) */
  readonly start?: WalkStart | undefined;
  /** 포스터 뒤 첫 화면의 모델·질감·셰이더·실제 그리기 준비 상태 */
  readonly onReady?: ((ready: boolean) => void) | undefined;
  /** 모델·질감·카드·캐릭터를 다 받음(그래픽 준비 전) — 준비 시간 상한 판단에 쓴다 */
  readonly onLoaded?: ((loaded: boolean) => void) | undefined;
  /** 조각 파일을 하나도 받지 못하고 목록을 다 돌았음(멈춤·실패, G-24 HW-01) — 3D를 그릴 수 없다 */
  readonly onLoadFail?: (() => void) | undefined;
  /** 3D 안 사인(V-03): 관 ID → 전시실 이름·소개. 없으면 사인 글을 그리지 않는다 */
  readonly signRooms?: ReadonlyMap<string, SignRoom> | undefined;
  /** 사인 판의 글자 자리(템플릿 manifest) */
  readonly signAreas?: Readonly<Partial<Record<SignKind, TextArea>>> | undefined;
  /** 작품을 눌렀을 때(교사 3D 미리 보기 — 걸어가 크게 보기 대신 그 작품 패널, PRD G-13). 없으면 크게 보기 */
  readonly onArtworkTap?: ((artworkId: string) => void) | undefined;
  /** 개발 화면 전용(외관 조각이 없을 때 대신 세울 것 등) — 조각 목록을 받아 그 위에 */
  readonly extra?: (modules: ReadonlyMap<string, unknown> | null) => ReactNode;
}

const noPeers = (): readonly PeerView[] => [];

export const placementsOf = (layout: Layout): ModulePlacement[] =>
  layout.modules.map(m => ({ module: m.type, x: m.pos[0], y: m.pos[1], z: m.pos[2], rotY: m.rotY }));

export const VisitorScene = ({
  layout,
  look,
  modulesUrl,
  fixturesUrl,
  title,
  artworks,
  holders,
  character,
  tier,
  placeOf,
  peers,
  bubbles,
  textures,
  cards,
  paused,
  onPose,
  onJump,
  onReady,
  onLoaded,
  onLoadFail,
  onRegion,
  start,
  reducedMotion,
  controller,
  extra,
  onArtworkTap,
  signRooms,
  signAreas,
}: VisitorSceneProps) => {
  const failRef = useRef(onLoadFail);
  failRef.current = onLoadFail;
  const [modulesReady, setModulesReady] = useState(false);
  const [fixturesReady, setFixturesReady] = useState(false);
  const [readyCharacter, setReadyCharacter] = useState<CharacterId | null>(null);
  const [docentsReady, setDocentsReady] = useState(false);
  const onModulesSettled = useCallback((settled: boolean, loaded: number, total: number) => {
    setModulesReady(settled);
    if (settled && total > 0 && loaded === 0) failRef.current?.();
  }, []);
  const onFixturesSettled = useCallback((settled: boolean) => setFixturesReady(settled), []);
  const modules = useTemplateModules(modulesUrl, look, onModulesSettled);
  const fixtureModels = useTemplateModules(fixturesUrl ?? [], look, onFixturesSettled);
  const placements = useMemo(() => placementsOf(layout), [layout]);
  const [region, setRegion] = useState('exterior');
  // 그리는 관: 구역이 바뀔 때 + 자리 표시(0.5초마다)가 바뀔 때 다시 계산 — 1m 칸으로 묶어 자주 바뀌지 않게
  // 칸을 구독해야 같은 칸의 정지 위치 기록이 늦은 React 커밋과 R3F 재그리기를 만들지 않는다.
  const cellX = useWalk(st => Math.round(st.me.x));
  const cellZ = useWalk(st => Math.round(st.me.z));
  const visible = useMemo(
    () => visibleParts(layout, region, { x: cellX, z: cellZ }, tier),
    [layout, region, cellX, cellZ, tier],
  );
  const partOf = useMemo(() => new Map(layout.frames.map(f => [f.artworkId, f.partId])), [layout]);
  // 말풍선 보이기: 다른 사람 자리 → 구역(걷기와 같은 지도)
  const regionOf = useMemo(() => {
    const map = buildGuideMap(layout);
    return (x: number, z: number): string => map.regionOf([x, z]);
  }, [layout]);
  // 상주 관리 초점: 지금 관에서 가장 가까운 작품(1m 칸) · 안내 목적지
  const stopIndex = useWalk(st => st.stopIndex);
  const guided = useWalk(st => st.mode !== 'free');
  const focus = useMemo<Focus>(() => {
    const inPart = layout.parts.some(p => p.partId === region) ? region : null;
    let nearestId: string | null = null;
    let best = Infinity;
    if (inPart)
      for (const a of artworks) {
        if (partOf.get(a.id) !== inPart) continue;
        const d = Math.hypot(a.center.x - cellX, a.center.z - cellZ);
        if (d < best) {
          best = d;
          nearestId = a.id;
        }
      }
    const targetId = guided ? (layout.stops[stopIndex]?.artworkId ?? null) : null;
    return { visibleParts: visible, partId: inPart, nearestId, targetId };
  }, [layout, region, artworks, partOf, cellX, cellZ, visible, guided, stopIndex]);
  const resident = useResidentTextures(textures ?? null, focus, tier);
  const cardTargets = useMemo(
    () =>
      cards
        ? artworks
            .filter(a => cards.has(a.id) && visible.has(partOf.get(a.id) ?? ''))
            .map(a => ({ id: a.id, aspect: a.art.w / a.art.h }))
        : [],
    [cards, artworks, visible, partOf],
  );
  const cardTex = useCardTextures(cards ?? null, cardTargets, look.card);
  const ready =
    modules !== null &&
    modulesReady &&
    fixturesReady &&
    resident.ready &&
    cardTargets.every(t => cardTex.has(t.id)) &&
    (controller !== undefined || readyCharacter === character) &&
    (layout.schemaVersion !== 3 || docentsReady);
  useEffect(() => {
    onLoaded?.(ready);
  }, [ready, onLoaded]);
  const shown = useMemo(
    () =>
      textures || cards
        ? artworks.map(a => {
            const t = resident.textureOf(a.id) ?? cardTex.get(a.id) ?? a.texture;
            return t === a.texture ? a : { ...a, texture: t };
          })
        : artworks,
    // `resident`(버전)·`cardTex`가 바뀌면 올라간 텍스처가 바뀐 것
    [artworks, textures, cards, resident, cardTex],
  );
  const preparation = useMemo(
    () => [modules, fixtureModels, shown, cardTex, character, tier],
    [modules, fixtureModels, shown, cardTex, character, tier],
  );
  const signs = useMemo(
    () => (signRooms && signAreas ? signItems(layout, signRooms, title, signAreas) : []),
    [layout, signRooms, title, signAreas],
  );
  const shownSigns = useMemo(() => visibleSigns(signs, visible), [signs, visible]);
  const sign = layout.fixtures.find(f => f.kind === 'facadeSign');
  // 공간 v4(스키마 3): 안내판 체계 렌더러가 글을 맡으므로 옛 설비 사인(외관 이름판·소개판)은 빼고 그린다(겹친 글·빈 판 없게)
  const v4 = layout.schemaVersion === 3;
  const fixtures = useMemo(() => (v4 ? withoutLegacySigns(layout.fixtures) : layout.fixtures), [layout, v4]);
  const labels = useMemo<LabelItem[]>(() => {
    const byId = new Map(artworks.map(a => [a.id, a]));
    return layout.labels.flatMap(l => {
      const a = byId.get(l.artworkId);
      if (!a || !visible.has(partOf.get(l.artworkId) ?? '')) return [];
      return [
        {
          artworkId: l.artworkId,
          pos: l.pos,
          normal: l.normal,
          away: labelAwayOf(l.pos, a.center, l.normal, a.mount === 'EASEL'),
          title: a.title,
          author: a.author,
          note: a.plateNote ?? '',
        },
      ];
    });
  }, [layout, artworks, visible, partOf]);
  const zoom = useWalk(st => st.api?.zoom);
  // 빛 웅덩이 세기(작품마다 하나, `MicroMotion`이 바꿈)와 마우스가 올라간 작품
  const invalidate = useThree(st => st.invalidate);
  const idsKey = artworks.map(a => a.id).join('|');
  const boosts = useMemo<Record<string, DimHolder>>(
    () => Object.fromEntries(idsKey.split('|').map(id => [id, { value: 1 }])),
    [idsKey],
  );
  const { hovered, onHover } = useArtworkHover(invalidate);
  // 둘레 사람(보간된 자리) — 내 캐릭터가 겹치지 않게 비켜 간다
  const crowd = useMemo(() => (peers ? () => peers.sample().map((p): P2 => [p.x, p.z]) : undefined), [peers]);
  return (
    <>
      <Stage look={look} indoor={0} />
      <Sky exterior={layout.exterior} look={look.outdoor.sky} />
      <ExteriorContact layout={layout} glow={look.outdoor.entranceGlow} />
      {modules && <TemplateModules modules={modules} placements={placements} />}
      {modules && layout.schemaVersion === 3 && (
        <BlockoutModules modules={modules} placements={placements} look={look} />
      )}
      {/* 공간 v4 전시실 벽 와시(W-12 ①, 그리기 1회) — 스키마 2면 그리지 않음 */}
      <WallWash layout={layout} visibleParts={visible} look={look.wash} tier={tier} />
      {extra?.(modules)}
      <FixtureModels fixtures={fixtures} models={fixtureModels} />
      {/* 공간 v4 장식(분수·조형·흉상·펜던트·안내 데스크 등, M5-3) — 보이는 구역의 것만, 종류마다 그리기 1회 */}
      {v4 && (
        <Decor layout={layout} region={region} visibleParts={visible} tier={tier} models={fixtureModels} />
      )}
      <ArtworkLabels items={labels} />
      {v4 ? (
        signRooms && (
          <SignsV4
            layout={layout}
            rooms={signRooms}
            title={title}
            look={look}
            tier={tier}
            at={{ x: cellX, z: cellZ }}
            totemTitle={copy.museumWalk.signTotem}
          />
        )
      ) : (
        <>
          <SignTexts items={shownSigns} />
          {sign && <FacadeSign fixture={sign} title={title} />}
        </>
      )}
      {shown
        .filter(a => visible.has(partOf.get(a.id) ?? ''))
        .map(a => (
          <ArtworkFrame
            key={a.id}
            artwork={a}
            holder={holders[a.id]!}
            onTap={id => (onArtworkTap ? onArtworkTap(id) : zoom?.(id))}
            pool={look.pool}
            boost={boosts[a.id]}
            onHover={onHover}
            look={look}
          />
        ))}
      {controller ? (
        controller(r => {
          setRegion(r);
          onRegion?.(r);
        })
      ) : (
        <WalkView
          layout={layout}
          artworks={artworks}
          character={character}
          placeOf={placeOf}
          onRegion={r => {
            setRegion(r);
            onRegion?.(r);
          }}
          crowd={crowd}
          paused={paused}
          onCharacterReady={setReadyCharacter}
          onPose={onPose}
          onJump={onJump}
          start={start}
          reducedMotion={reducedMotion}
        />
      )}
      {layout.schemaVersion === 3 && (
        <Docents
          layout={layout}
          region={region}
          visibleParts={visible}
          interactive={!controller}
          reducedMotion={reducedMotion ?? false}
          onReady={setDocentsReady}
        />
      )}
      {!controller && <ZoomDim holders={holders} reducedMotion={reducedMotion ?? false} />}
      <MicroMotion
        boosts={boosts}
        hovered={hovered}
        tier={tier}
        reducedMotion={reducedMotion ?? false}
        color={look.dust}
      />
      <Vignette strength={vignetteOf(tier)} />
      {peers && (
        <Peers
          sample={peers.sample}
          busy={peers.busy}
          me={() => useWalk.getState().me}
          maxFull={peers.maxFull}
          labelOf={peers.labelOf}
          invalidate={peers.invalidate}
          reducedMotion={reducedMotion ?? false}
        />
      )}
      {bubbles && !controller && (
        <Bubbles
          board={bubbles.board}
          sample={peers ? peers.sample : noPeers}
          me={() => useWalk.getState().me}
          myCharacter={character}
          mineVisible={() => useWalk.getState().mode !== 'zoom'}
          region={region}
          regionOf={regionOf}
          visibleParts={visible}
          device={bubbles.device}
          reducedMotion={reducedMotion ?? false}
          invalidate={bubbles.invalidate}
        />
      )}
      <ScenePreparation ready={ready} revision={preparation} paused={paused ?? false} onReady={onReady} />
    </>
  );
};
