import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { STICKER_ATLAS_URL, stickerRect, stickerUiUrl, STICKER_COLS, STICKER_ROWS } from './bubbleAtlas.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../../public');
/** KTX2 파일 머리(KTX 2.0 식별자 12바이트) */
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

describe('말풍선 스티커 그림(M4-1)', () => {
  it('칸: 스티커 수가 아틀라스 칸 안에 들고, 0번은 왼쪽 위·마지막은 그 줄 안(캔버스와 KTX2가 같은 UV — 위가 v=1)', () => {
    const n = config().BUBBLE_STICKERS;
    expect(STICKER_COLS * STICKER_ROWS).toBeGreaterThanOrEqual(n);
    const first = stickerRect(0);
    expect(first).toEqual({ u0: 0, u1: 1 / STICKER_COLS, v0: 1 - 1 / STICKER_ROWS, v1: 1, aspect: 1 });
    const last = stickerRect(n - 1);
    expect(last.v0).toBeGreaterThanOrEqual(0);
    expect(last.u1).toBeLessThanOrEqual(1);
  });

  it('서랍 단추 그림 주소: 1부터 두 자리, 범위 밖은 null(이름 글자로 그림)', () => {
    expect(stickerUiUrl(0)).toBe('/assets/g/stk-1/s01.webp');
    expect(stickerUiUrl(11)).toBe('/assets/g/stk-1/s12.webp');
    expect(stickerUiUrl(config().BUBBLE_STICKERS)).toBeNull();
    expect(stickerUiUrl(-1)).toBeNull();
    expect(stickerUiUrl(1.5)).toBeNull();
  });

  it('파일: 아틀라스(KTX2, 상한 안)와 서랍 그림이 모두 저장소에 있다', () => {
    const atlas = readFileSync(join(PUBLIC, STICKER_ATLAS_URL));
    expect([...atlas.subarray(0, KTX2_ID.length)]).toEqual(KTX2_ID);
    expect(atlas.byteLength).toBeLessThanOrEqual(config().BUBBLE_ATLAS.maxBytes);
    for (let i = 0; i < config().BUBBLE_STICKERS; i++) {
      const url = stickerUiUrl(i);
      expect(url && existsSync(join(PUBLIC, url)), url ?? String(i)).toBe(true);
    }
  });
});
