import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import type { LayoutInput } from '@gallery/core/types';
import type { Deps, LayoutRecord } from '../ports/index.ts';
import { liveExhibition } from './common.ts';

/**
 * 배치 다시 계산(PLAN §4.10·§9.2 `recomputeLayout`). `layout_dirty`인 전시만, 같은 트랜잭션에서.
 * 해시가 바뀔 때만 판을 올리고 최근 `LAYOUT_KEEP_VERSIONS`판만 남긴다. 엔진 판(`algoVersion`)이 바뀌어도
 * 저장된 배치는 다시 계산하지 않는다 — 그 전시에 다음 변경이 생길 때 새 판으로(수업 중 갑자기 바뀌지 않게).
 */

/** 게시 작품(숨김·처리 중·실패·지운 것 제외) → 배치 입력 */
export const layoutInputOf = (deps: Deps, exhibitionId: string): LayoutInput => {
  const ex = liveExhibition(deps, exhibitionId);
  const rooms = deps.store.rooms.listByExhibition(ex.id);
  const published = deps.store.artworks
    .listByExhibition(ex.id)
    .filter(a => a.status === 'PUBLISHED' && a.deletedAt === null);
  const sourceIds = published.flatMap(a => (a.sourceAssetId ? [a.sourceAssetId] : []));
  const pages = deps.store.pages.listByArtworks(published.filter(a => a.kind === 'PDF').map(a => a.id));
  const firstPage = new Map(pages.filter(p => p.idx === 1).map(p => [p.artworkId, p.assetId]));
  const assets = new Map(
    deps.store.assets.listByIds([...sourceIds, ...firstPage.values()]).map(x => [x.id, x]),
  );
  return {
    exhibitionId: ex.id,
    templateId: ex.templateId,
    algoVersion: config().ALGO_VERSION,
    rooms: rooms.map(r => ({ id: r.id, order: r.order, hasBgm: r.bgmAssetId !== null })),
    artworks: published.map(a => {
      const asset = assets.get((a.kind === 'PDF' ? firstPage.get(a.id) : a.sourceAssetId) ?? '');
      return {
        id: a.id,
        roomId: a.roomId,
        order: a.order,
        kind: a.kind,
        form: a.formOverride ?? a.form,
        featured: a.featured,
        textHeavy: a.textHeavyOverride ?? a.textHeavy,
        pixel: { w: asset?.width ?? 0, h: asset?.height ?? 0 },
        pageCount: a.pageCount,
      };
    }),
  };
};

/** 바뀐 것이 있으면 다시 계산해 저장하고 최신 배치를 돌려준다 */
export const recomputeLayout = (deps: Deps, exhibitionId: string): LayoutRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const latest = deps.store.layouts.latest(ex.id);
    if (!ex.layoutDirty && latest) return latest;
    const layout = computeLayout(layoutInputOf(deps, ex.id));
    if (latest && latest.hash === layout.hash && latest.algoVersion === layout.algoVersion) {
      deps.store.exhibitions.update(ex.id, { layoutDirty: false });
      return latest;
    }
    const rec: LayoutRecord = {
      exhibitionId: ex.id,
      version: ex.layoutVersion + 1,
      algoVersion: layout.algoVersion,
      hash: layout.hash,
      data: layout,
      createdAt: deps.clock.now(),
    };
    deps.store.layouts.insert(rec);
    deps.store.layouts.prune(ex.id, config().LAYOUT_KEEP_VERSIONS);
    deps.store.exhibitions.update(ex.id, { layoutVersion: rec.version, layoutDirty: false });
    return rec;
  });
