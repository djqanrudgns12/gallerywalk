import { classifyForm, guessTextHeavy } from '@gallery/core/classify';
import { AppError } from '@gallery/core/errors';
import type { CreateTextArtworkSchema } from '@gallery/core/types';
import type { z } from 'zod';
import type { ArtworkRecord, Deps } from '../ports/index.ts';
import { nextOrder } from './artworks.ts';
import { assertSameExhibition, bump, createHashOf, liveExhibition } from './common.ts';

/**
 * 글 작품 만들기(PLAN §9.2 `POST …/{id}/artworks`의 JSON 글, §5.7). 파일 작품(그림·HEIC·소리·PDF)은 미디어 처리와 함께(P3-4).
 * ID는 기기가 만든 UUID — 같은 ID·같은 본문이면 처음 행을 그대로(멱등), 본문이 다르거나 다른 전시의 ID면 `E_CONFLICT`.
 * 글은 처리할 파일이 없어 바로 게시(`PUBLISHED`)로 만든다(파일 작품도 처리가 끝나면 게시, PDF는 3단계 완성 때).
 */

type CreateTextArtwork = z.infer<typeof CreateTextArtworkSchema>;

export const createTextArtwork = (
  deps: Deps,
  exhibitionId: string,
  body: CreateTextArtwork,
): ArtworkRecord => {
  const hash = createHashOf(body);
  return deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const existing = deps.store.artworks.get(body.id);
    if (existing) {
      if (existing.exhibitionId !== ex.id || existing.createHash !== hash) throw new AppError('E_CONFLICT');
      return existing;
    }
    assertSameExhibition(deps.store.rooms.get(body.roomId), ex.id);
    // 글은 화소가 없다 — 형태는 종류로만 정해진다(TEXTCARD)
    const form = classifyForm({ kind: 'TEXT', w: 0, h: 0, pageCount: 1 });
    const now = deps.clock.now();
    const rec: ArtworkRecord = {
      id: body.id,
      exhibitionId: ex.id,
      roomId: body.roomId,
      // 순서는 서버가 그 전시실 끝에 붙인다(ADR-074) — 기기가 보낸 `order`는 무시(멱등 해시에는 남음)
      order: nextOrder(deps, ex.id, body.roomId),
      title: body.title,
      author: null,
      captionShort: null,
      descriptionLong: null,
      kind: 'TEXT',
      form,
      formOverride: null,
      textHeavy: guessTextHeavy({ kind: 'TEXT', form, fileName: body.title, linePitchPx: null }),
      textHeavyOverride: null,
      featured: false,
      pageMode: 'AUTO',
      status: 'PUBLISHED',
      sourceAssetId: null,
      pageCount: null,
      textBody: body.textBody,
      warnings: [],
      failCode: null,
      deletedAt: null,
      rev: 1,
      createHash: hash,
      createdAt: now,
      updatedAt: now,
    };
    deps.store.artworks.insert(rec);
    bump(deps, ex, { content: true, layout: true });
    return rec;
  });
};
