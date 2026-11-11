import { AppError } from '@gallery/core/errors';
import { publicSummary } from '@gallery/core/reactions';
import type {
  ArtworkPublic,
  ArtworkTeacher,
  AssetRef,
  ExhibitionPublic,
  ExhibitionTeacher,
  ExhibitionView,
  RoomPublic,
  TeacherExhibitionView,
  VersionInfo,
} from '@gallery/core/types';
import { isGone } from '@gallery/core/retention';
import type { AudioAnalysis, ImageAnalysisWire } from '@gallery/core/types';
import type {
  ArtworkRecord,
  AssetRecord,
  Deps,
  ExhibitionRecord,
  PageRecord,
  RoomRecord,
} from '../ports/index.ts';
import { liveExhibition } from './common.ts';
import { recomputeLayout } from './layout.ts';

/**
 * 보기 묶음(PLAN §9.2): 학생 `GET /api/e/{code}`(OPEN만), 교사 `GET /api/teacher/exhibitions/{id}`.
 * 미디어 주소는 넣지 않는다 — 기기가 `mediaPath(exhibitionId, assetId, variant)`로 만든다.
 */

const ref = (a: AssetRecord, only?: (name: string) => boolean): AssetRef | null => {
  const variants = only ? a.variants.filter(v => only(v.name)) : a.variants.filter(v => v.name !== 'cover');
  return variants.length > 0 ? { assetId: a.id, variants: [...variants] } : null;
};

const imageAnalysis = (a: AssetRecord | undefined): ImageAnalysisWire | null =>
  a?.analysis && 'edgeLuma' in a.analysis ? a.analysis : null;
const audioAnalysis = (a: AssetRecord | undefined): AudioAnalysis | null =>
  a?.analysis && 'audibleStartMs' in a.analysis ? a.analysis : null;

interface Media {
  readonly assets: ReadonlyMap<string, AssetRecord>;
  readonly pages: ReadonlyMap<string, readonly PageRecord[]>;
}

const loadMedia = (
  deps: Deps,
  ex: ExhibitionRecord,
  artworks: readonly ArtworkRecord[],
  rooms: readonly RoomRecord[],
): Media => {
  const pageRows = deps.store.pages.listByArtworks(artworks.filter(a => a.kind === 'PDF').map(a => a.id));
  const ids = [
    ...artworks.flatMap(a => (a.sourceAssetId ? [a.sourceAssetId] : [])),
    ...pageRows.map(p => p.assetId),
    ...rooms.flatMap(r => (r.bgmAssetId ? [r.bgmAssetId] : [])),
    ...(ex.posterAssetId ? [ex.posterAssetId] : []),
  ];
  const pages = new Map<string, PageRecord[]>();
  for (const p of [...pageRows].sort((x, y) => x.idx - y.idx))
    pages.set(p.artworkId, [...(pages.get(p.artworkId) ?? []), p]);
  return { assets: new Map(deps.store.assets.listByIds(ids).map(a => [a.id, a])), pages };
};

const artworkMedia = (
  a: ArtworkRecord,
  m: Media,
): Pick<ArtworkPublic, 'image' | 'pages' | 'audio' | 'textBody'> => {
  const src = a.sourceAssetId ? m.assets.get(a.sourceAssetId) : undefined;
  const srcImage = imageAnalysis(src);
  const image =
    a.kind === 'IMAGE' && src && srcImage && src.width && src.height
      ? (() => {
          const asset = ref(src);
          return asset ? { asset, w: src.width, h: src.height, analysis: srcImage } : null;
        })()
      : null;
  const pages =
    a.kind === 'PDF'
      ? (m.pages.get(a.id) ?? []).flatMap(p => {
          const pa = m.assets.get(p.assetId);
          const asset = pa ? ref(pa) : null;
          const analysis = imageAnalysis(pa);
          return pa && analysis && pa.width && pa.height && asset
            ? [{ idx: p.idx, asset, w: pa.width, h: pa.height, analysis }]
            : [];
        })
      : null;
  const srcAudio = audioAnalysis(src);
  const audio =
    a.kind === 'AUDIO' && src?.durationMs && srcAudio
      ? (() => {
          const asset = ref(src);
          return asset
            ? {
                asset,
                durationMs: src.durationMs,
                analysis: srcAudio,
                cover: ref(src, name => name === 'cover'),
              }
            : null;
        })()
      : null;
  return { image, pages, audio, textBody: a.kind === 'TEXT' ? a.textBody : null };
};

const toArtworkPublic = (a: ArtworkRecord, m: Media): ArtworkPublic => ({
  id: a.id,
  roomId: a.roomId,
  order: a.order,
  title: a.title,
  author: a.author,
  caption: a.captionShort,
  description: a.descriptionLong,
  kind: a.kind,
  form: a.formOverride ?? a.form,
  textHeavy: a.textHeavyOverride ?? a.textHeavy,
  featured: a.featured,
  pageMode: a.pageMode,
  ...artworkMedia(a, m),
});

const toArtworkTeacher = (a: ArtworkRecord, m: Media): ArtworkTeacher => ({
  ...toArtworkPublic(a, m),
  status: a.status,
  formAuto: a.form,
  formOverride: a.formOverride,
  textHeavyAuto: a.textHeavy,
  textHeavyOverride: a.textHeavyOverride,
  warnings: [...a.warnings],
  failCode: a.failCode,
  rev: a.rev,
  deletedAt: a.deletedAt,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const toRoomPublic = (r: RoomRecord, m: Media): RoomPublic => {
  const asset = r.bgmAssetId ? m.assets.get(r.bgmAssetId) : undefined;
  const analysis = audioAnalysis(asset);
  const bgmRef = asset ? ref(asset) : null;
  return {
    id: r.id,
    order: r.order,
    title: r.title,
    intro: r.intro,
    bgm:
      asset?.durationMs && analysis && bgmRef
        ? { asset: bgmRef, durationMs: asset.durationMs, analysis }
        : null,
  };
};

const versions = (ex: ExhibitionRecord) => ({
  layoutVersion: ex.layoutVersion,
  contentVersion: ex.contentVersion,
  settingsVersion: ex.settingsVersion,
});

const byOrder = <T extends { order: number; id: string }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** 학생: 입장 코드 → 보기 묶음. DRAFT·CLOSED는 오류 코드, 없거나 만료·지우는 중이면 없음 */
export const exhibitionView = (deps: Deps, entryCode: string): ExhibitionView => {
  const found = deps.store.exhibitions.getByEntryCode(entryCode);
  if (!found || isGone(found, deps.clock.now())) throw new AppError('E_NOT_FOUND');
  if (found.status === 'DRAFT') throw new AppError('E_EXHIBITION_DRAFT');
  if (found.status === 'CLOSED') throw new AppError('E_EXHIBITION_CLOSED');
  const layout = recomputeLayout(deps, found.id);
  const ex = deps.store.exhibitions.get(found.id)!;
  const rooms = byOrder(deps.store.rooms.listByExhibition(ex.id));
  const artworks = byOrder(
    deps.store.artworks.listByExhibition(ex.id).filter(a => a.status === 'PUBLISHED' && a.deletedAt === null),
  );
  const media = loadMedia(deps, ex, artworks, rooms);
  const poster = ex.posterAssetId ? media.assets.get(ex.posterAssetId) : undefined;
  const exhibition: ExhibitionPublic = {
    id: ex.id,
    title: ex.title,
    subtitle: ex.subtitle,
    templateId: ex.templateId,
    poster: poster ? ref(poster) : null,
    school: ex.showSchool ? { schoolName: ex.schoolName, className: ex.className } : null,
    expiresAt: ex.expiresAt,
    reactions: ex.settings.reactions,
  };
  const reactions = deps.store.reactions.listByExhibition(ex.id);
  const nickname = new Map<string, string | null>();
  for (const r of reactions)
    if (!nickname.has(r.visitorTokenHash))
      nickname.set(r.visitorTokenHash, deps.store.visitors.get(r.visitorTokenHash, ex.id)?.nickname ?? null);
  return {
    exhibition,
    rooms: rooms.map(r => toRoomPublic(r, media)),
    artworks: artworks.map(a => toArtworkPublic(a, media)),
    layout: layout.data,
    versions: versions(ex),
    reactions: artworks.map(a =>
      publicSummary(
        ex.settings.reactions,
        a.id,
        reactions
          .filter(r => r.artworkId === a.id)
          .map(r => ({ ...r, nickname: nickname.get(r.visitorTokenHash) ?? null })),
      ),
    ),
  };
};

/** 학생: 60초 버전 확인(ADR-027) */
export const versionInfo = (deps: Deps, entryCode: string): VersionInfo => {
  const ex = deps.store.exhibitions.getByEntryCode(entryCode);
  if (!ex || isGone(ex, deps.clock.now())) throw new AppError('E_NOT_FOUND');
  return { ...versions(ex), status: ex.status };
};

/** 교사: 숨김·처리 중·실패·지운 작품(되살리기 전) 포함 */
export const teacherView = (deps: Deps, exhibitionId: string): TeacherExhibitionView => {
  const layout = recomputeLayout(deps, exhibitionId);
  const ex = liveExhibition(deps, exhibitionId);
  const rooms = byOrder(deps.store.rooms.listByExhibition(ex.id));
  const artworks = byOrder(deps.store.artworks.listByExhibition(ex.id, { includeDeleted: true }));
  const media = loadMedia(deps, ex, artworks, rooms);
  const poster = ex.posterAssetId ? media.assets.get(ex.posterAssetId) : undefined;
  const exhibition: ExhibitionTeacher = {
    id: ex.id,
    entryCode: ex.entryCode,
    title: ex.title,
    subtitle: ex.subtitle,
    templateId: ex.templateId,
    poster: poster ? ref(poster) : null,
    schoolName: ex.schoolName,
    className: ex.className,
    showSchool: ex.showSchool,
    settings: ex.settings,
    status: ex.status,
    rev: ex.rev,
    createdAt: ex.createdAt,
    expiresAt: ex.expiresAt,
    openedAt: ex.openedAt,
    closedAt: ex.closedAt,
  };
  return {
    exhibition,
    rooms: rooms.map(r => ({ ...toRoomPublic(r, media), rev: r.rev })),
    artworks: artworks.map(a => toArtworkTeacher(a, media)),
    layout: artworks.some(a => a.status === 'PUBLISHED' && a.deletedAt === null) ? layout.data : null,
    versions: versions(ex),
  };
};
