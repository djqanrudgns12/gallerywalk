import { classifyForm, guessTextHeavy } from '@gallery/core/classify';
import { AppError, errorCatalog } from '@gallery/core/errors';
import type { CreateFileArtworkMetaSchema, CreatePdfArtworkSchema } from '@gallery/core/types';
import type { z } from 'zod';
import { nextOrder } from '../application/artworks.ts';
import { assertSameExhibition, bump, createHashOf, liveExhibition } from '../application/common.ts';
import type { ArtworkRecord, AssetRecord, Deps, UploadTarget } from '../ports/index.ts';

export type UploadDeps = Pick<Deps, 'store' | 'clock'>;
export type FileMeta = z.infer<typeof CreateFileArtworkMetaSchema>;
type PdfMeta = z.infer<typeof CreatePdfArtworkSchema>;
type ArtworkMeta = FileMeta | PdfMeta;

export const ownRoom = (deps: UploadDeps, exhibitionId: string, roomId: string) => {
  const room = deps.store.rooms.get(roomId);
  assertSameExhibition(room, exhibitionId);
  return room!;
};

export const ownPdf = (deps: UploadDeps, exhibitionId: string, artworkId: string) => {
  const art = deps.store.artworks.get(artworkId);
  assertSameExhibition(art, exhibitionId);
  if (art!.deletedAt !== null) throw new AppError('E_NOT_FOUND');
  if (art!.kind !== 'PDF') throw new AppError('E_VALIDATION', { fields: { kind: 'PDF' } });
  return art!;
};

export const checkTarget = (deps: UploadDeps, exhibitionId: string, target: UploadTarget): void => {
  liveExhibition(deps, exhibitionId);
  if (target.kind === 'BGM') ownRoom(deps, exhibitionId, target.roomId);
  if (target.kind === 'PAGE') {
    const art = ownPdf(deps, exhibitionId, target.artworkId);
    if (!Number.isSafeInteger(target.idx) || target.idx < 1 || target.idx > (art.pageCount ?? 0))
      throw new AppError('E_VALIDATION', { fields: { idx: 'page_range' } });
    // 쪽을 받기 시작한 때를 남긴다 — 마치지 못한 PDF 정리(`PDF_INCOMPLETE_PURGE_HOURS`)가 받는 중인 것을 치우지 않게
    if (art.status === 'PROCESSING') deps.store.artworks.update(art.id, { updatedAt: deps.clock.now() });
  }
};

export const newArtwork = (
  deps: UploadDeps,
  exhibitionId: string,
  meta: ArtworkMeta,
  createHash: string,
): ArtworkRecord => {
  const form = classifyForm({
    kind: meta.kind,
    w: 1,
    h: 1,
    pageCount: meta.kind === 'PDF' ? meta.pageCount : 1,
  });
  const now = deps.clock.now();
  return {
    id: meta.id,
    exhibitionId,
    roomId: meta.roomId,
    // 순서는 서버가 그 전시실 끝에 붙인다(ADR-074) — 기기가 보낸 `order`는 무시(멱등 해시에는 남음)
    order: nextOrder(deps, exhibitionId, meta.roomId),
    title: meta.title,
    author: null,
    captionShort: null,
    descriptionLong: null,
    kind: meta.kind,
    form,
    formOverride: null,
    textHeavy: guessTextHeavy({ kind: meta.kind, form, fileName: meta.title, linePitchPx: null }),
    textHeavyOverride: null,
    featured: false,
    pageMode: 'AUTO',
    status: 'PROCESSING',
    sourceAssetId: null,
    pageCount: meta.kind === 'PDF' ? meta.pageCount : null,
    textBody: null,
    warnings: [],
    failCode: null,
    deletedAt: null,
    rev: 1,
    createHash,
    createdAt: now,
    updatedAt: now,
  };
};

/** 다른 전시의 ID는 있는지 알려 주지 않는다. 파일 만들기 해시는 정규 meta와 내용 해시를 함께 묶는다. */
export const fileReplay = (
  deps: UploadDeps,
  exhibitionId: string,
  meta: FileMeta,
  hash: string,
): ArtworkRecord | null => {
  const prior = deps.store.artworks.get(meta.id);
  if (!prior) return null;
  assertSameExhibition(prior, exhibitionId);
  if (prior.createHash !== hash) throw new AppError('E_CONFLICT');
  if (prior.status === 'FAILED' && prior.failCode !== null) {
    if (errorCatalog[prior.failCode].retryable) return null;
    throw new AppError(prior.failCode);
  }
  return prior;
};

/** 이미 지운 작품의 내용은 중복으로 세지 않는다. PDF 쪽은 같은 PDF 안에서는 같은 그림을 허용한다. */
export const assertUniqueFile = (
  deps: UploadDeps,
  exhibitionId: string,
  contentHash: string,
  exceptArtworkId?: string,
): void => {
  const arts = deps.store.artworks.listByExhibition(exhibitionId).filter(a => a.id !== exceptArtworkId);
  const ids = [
    ...arts.flatMap(a => (a.sourceAssetId === null ? [] : [a.sourceAssetId])),
    ...deps.store.pages.listByArtworks(arts.map(a => a.id)).map(p => p.assetId),
  ];
  if (deps.store.assets.listByIds(ids).some(a => a.contentHash === contentHash))
    throw new AppError('E_DUPLICATE');
};

export const pageReplay = (
  deps: UploadDeps,
  exhibitionId: string,
  artworkId: string,
  idx: number,
  contentHash: string,
): AssetRecord | null => {
  const page = deps.store.pages.listByArtworks([artworkId]).find(p => p.idx === idx);
  if (!page) return null;
  const asset = deps.store.assets.get(page.assetId);
  assertSameExhibition(asset, exhibitionId);
  if (asset!.contentHash !== contentHash) throw new AppError('E_CONFLICT');
  return asset;
};

/** PDF 1단계. 쪽 번호와 내용 해시는 각 쪽 asset에 저장한다. */
export const createPdfArtwork = (deps: UploadDeps, exhibitionId: string, meta: PdfMeta): ArtworkRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const hash = createHashOf(meta);
    const prior = deps.store.artworks.get(meta.id);
    if (prior) {
      assertSameExhibition(prior, ex.id);
      if (prior.createHash !== hash) throw new AppError('E_CONFLICT');
      return prior;
    }
    ownRoom(deps, ex.id, meta.roomId);
    const art = newArtwork(deps, ex.id, meta, hash);
    deps.store.artworks.insert(art);
    bump(deps, ex, { content: true });
    return art;
  });

/** PDF 3단계. 누락 목록과 asset의 실제 처리 결과를 한 트랜잭션 안에서 확인한다. */
export const completePdfArtwork = (deps: UploadDeps, exhibitionId: string, artworkId: string): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const art = ownPdf(deps, ex.id, artworkId);
    const pages = deps.store.pages.listByArtworks([art.id]);
    const missing: number[] = [];
    for (let idx = 1; idx <= (art.pageCount ?? 0); idx++) {
      const page = pages.find(p => p.idx === idx);
      const asset = page ? deps.store.assets.get(page.assetId) : null;
      if (
        !asset ||
        asset.exhibitionId !== ex.id ||
        asset.kind !== 'PAGE' ||
        !asset.width ||
        !asset.height ||
        !asset.analysis ||
        !('edgeLuma' in asset.analysis) ||
        asset.variants.length === 0
      )
        missing.push(idx);
    }
    if (missing.length > 0 || art.pageCount === null)
      throw new AppError('E_VALIDATION', { fields: { pages: missing.join(',') } });
    if (art.status === 'PUBLISHED' || art.status === 'HIDDEN') return;
    deps.store.artworks.update(art.id, {
      status: 'PUBLISHED',
      failCode: null,
      rev: art.rev + 1,
      updatedAt: deps.clock.now(),
    });
    bump(deps, ex, { content: true, layout: true });
  });

/** 포스터·음악을 빼도 immutable asset은 남아 기존 캐시·재시도와 충돌하지 않는다(고아 정리가 회수). */
export const removeAttachment = (deps: UploadDeps, exhibitionId: string, target: UploadTarget): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    if (target.kind === 'POSTER' && ex.posterAssetId !== null) {
      deps.store.exhibitions.update(ex.id, { posterAssetId: null, rev: ex.rev + 1 });
      bump(deps, ex, { content: true });
    }
    if (target.kind === 'BGM') {
      const room = ownRoom(deps, ex.id, target.roomId);
      if (room.bgmAssetId === null) return;
      deps.store.rooms.update(room.id, { bgmAssetId: null, rev: room.rev + 1, updatedAt: deps.clock.now() });
      bump(deps, ex, { content: true });
    }
  });
