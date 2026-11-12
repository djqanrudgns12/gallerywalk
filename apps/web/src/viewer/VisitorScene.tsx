import type { TemplateLook } from '@gallery/core/templates';
import type { P2 } from '@gallery/core/layout';
import type { CharacterId, Layout, Pose } from '@gallery/core/types';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type PeerView } from './live/peerBuffer.ts';
import { Peers } from './live/Peers.tsx';
import { ArtworkFrame } from './scene/ArtworkFrame.tsx';
import { ArtworkLabels, type LabelItem } from './scene/ArtworkLabels.tsx';
import { ExteriorContact } from './scene/ExteriorContact.tsx';
import { FacadeSign } from './scene/FacadeSign.tsx';
import { FixtureModels } from './scene/FixtureModels.tsx';
import type { DimHolder } from './scene/materials.ts';
import { Sky } from './scene/Sky.tsx';
import { Stage } from './scene/Stage.tsx';
import { type ModulePlacement, TemplateModules, useTemplateModules } from './scene/TemplateModules.tsx';
import type { ViewerArtwork } from './scene/types.ts';
import type { Focus, Tier } from './textures/residency.ts';
import type { CardText } from './textures/textCard.ts';
import { useCardTextures } from './textures/useCardTextures.ts';
import { type ArtworkTextureSource, useResidentTextures } from './textures/useResidentTextures.ts';
import { visibleParts } from './walk/visibleParts.ts';
import { type WalkStart, WalkView } from './walk/WalkView.tsx';
import { useWalk } from './walk/walkStore.ts';
import { ZoomDim } from './walk/ZoomDim.tsx';

/**
 * 자유 관람 3D 장면 한 벌(ADR-057): 무대 빛·하늘·템플릿 조각·설비·정면 이름판·명판·액자·캐릭터·다른 관람객.
 * 학생 관람 화면과 개발 화면(`/dev/walk`)이 같은 것을 쓴다. Canvas 안에 넣는다.
 * 액자·명판은 캐릭터 둘레의 관만(`visibleParts`, §6.6) — 멀어진 관은 떼어 놓는다.
 */

export interface VisitorPeers {
  readonly sample: () => readonly PeerView[];
  readonly busy: () => boolean;
  readonly labelOf: (p: PeerView) => { text: string; teacher: boolean };
  readonly maxFull: number;
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
  /** 그림 파일 없는 작품(글·소리)의 카드 글 — 그리는 관의 것만 캔버스로 조판해 건다(§5.7) */
  readonly cards?: ReadonlyMap<string, CardText> | null | undefined;
  /** 작품 그림 상주 관리(§6.5) 입력. 없으면 작품의 `texture`를 그대로(개발 화면의 합성 그림) */
  readonly textures?: ArtworkTextureSource | null | undefined;
  /** 포스터 뒤에서 미리 준비하는 중(첫 인사 손 흔들기를 미룸) */
  readonly paused?: boolean | undefined;
  /** 그린 프레임마다 내 자리(함께 관람 보내기) */
  readonly onPose?: ((pose: Pose) => void) | undefined;
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
  /** 첫 조각 묶음(외관)이 올라와 첫 자리를 그릴 수 있음 — 한 번 */
  readonly onReady?: (() => void) | undefined;
  /** 작품을 눌렀을 때(교사 3D 미리 보기 — 걸어가 크게 보기 대신 그 작품 패널, PRD G-13). 없으면 크게 보기 */
  readonly onArtworkTap?: ((artworkId: string) => void) | undefined;
  /** 개발 화면 전용(외관 조각이 없을 때 대신 세울 것 등) — 조각 목록을 받아 그 위에 */
  readonly extra?: (modules: ReadonlyMap<string, unknown> | null) => ReactNode;
}

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
  textures,
  cards,
  paused,
  onPose,
  onReady,
  onRegion,
  start,
  reducedMotion,
  controller,
  extra,
  onArtworkTap,
}: VisitorSceneProps) => {
  const modules = useTemplateModules(modulesUrl, look);
  const loaded = modules !== null;
  useEffect(() => {
    if (loaded) onReady?.();
  }, [loaded, onReady]);
  const fixtureModels = useTemplateModules(fixturesUrl ?? [], look);
  const placements = useMemo(() => placementsOf(layout), [layout]);
  const [region, setRegion] = useState('exterior');
  // 그리는 관: 구역이 바뀔 때 + 자리 표시(0.5초마다)가 바뀔 때 다시 계산 — 1m 칸으로 묶어 자주 바뀌지 않게
  const me = useWalk(st => st.me);
  const cellX = Math.round(me.x);
  const cellZ = Math.round(me.z);
  const visible = useMemo(
    () => visibleParts(layout, region, { x: cellX, z: cellZ }, tier),
    [layout, region, cellX, cellZ, tier],
  );
  const partOf = useMemo(() => new Map(layout.frames.map(f => [f.artworkId, f.partId])), [layout]);
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
  const sign = layout.fixtures.find(f => f.kind === 'facadeSign');
  const labels = useMemo<LabelItem[]>(() => {
    const byId = new Map(artworks.map(a => [a.id, a]));
    return layout.labels.flatMap(l => {
      const a = byId.get(l.artworkId);
      if (!a || !visible.has(partOf.get(l.artworkId) ?? '')) return [];
      return [{ artworkId: l.artworkId, pos: l.pos, normal: l.normal, title: a.title, author: a.author }];
    });
  }, [layout, artworks, visible, partOf]);
  const zoom = useWalk(st => st.api?.zoom);
  // 둘레 사람(보간된 자리) — 내 캐릭터가 겹치지 않게 비켜 간다
  const crowd = useMemo(() => (peers ? () => peers.sample().map((p): P2 => [p.x, p.z]) : undefined), [peers]);
  return (
    <>
      <Stage look={look} indoor={0} />
      <Sky exterior={layout.exterior} />
      <ExteriorContact layout={layout} />
      {modules && <TemplateModules modules={modules} placements={placements} />}
      {extra?.(modules)}
      <FixtureModels fixtures={layout.fixtures} models={fixtureModels} />
      <ArtworkLabels items={labels} />
      {sign && <FacadeSign fixture={sign} title={title} />}
      {shown
        .filter(a => visible.has(partOf.get(a.id) ?? ''))
        .map(a => (
          <ArtworkFrame
            key={a.id}
            artwork={a}
            holder={holders[a.id]!}
            onTap={id => (onArtworkTap ? onArtworkTap(id) : zoom?.(id))}
            pool={look.pool}
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
          onPose={onPose}
          start={start}
          reducedMotion={reducedMotion}
        />
      )}
      {!controller && <ZoomDim holders={holders} reducedMotion={reducedMotion ?? false} />}
      {peers && (
        <Peers
          sample={peers.sample}
          busy={peers.busy}
          me={() => useWalk.getState().me}
          maxFull={peers.maxFull}
          labelOf={peers.labelOf}
          invalidate={peers.invalidate}
        />
      )}
    </>
  );
};
