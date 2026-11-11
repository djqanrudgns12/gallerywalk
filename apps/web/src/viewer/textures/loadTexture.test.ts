import { describe, expect, it } from 'vitest';
import { BitmapTexture, loadArtworkTexture } from './loadTexture.ts';

const fakeBitmap = () => {
  let closed = false;
  const bmp = { width: 4, height: 2, close: () => (closed = true) } as unknown as ImageBitmap;
  return { bmp, closed: () => closed };
};

describe('loadArtworkTexture', () => {
  it('받아서 위아래를 UV로 뒤집은 텍스처, 해제하면 ImageBitmap도 닫는다', async () => {
    const b = fakeBitmap();
    const urls: string[] = [];
    const tex = await loadArtworkTexture('/assets/g/m/x/y/wall.webp', {
      fetch: async url => {
        urls.push(url);
        return new Response(new Blob([new Uint8Array([1, 2, 3])]));
      },
      decode: async () => b.bmp,
    });
    expect(urls).toEqual(['/assets/g/m/x/y/wall.webp']);
    expect(tex).toBeInstanceOf(BitmapTexture);
    expect(tex.flipY).toBe(false);
    expect(tex.repeat.y).toBe(-1);
    expect(tex.offset.y).toBe(1);
    expect(tex.premultiplyAlpha).toBe(true);
    tex.dispose();
    expect(b.closed()).toBe(true);
  });

  it('응답이 실패면 거절', async () => {
    await expect(
      loadArtworkTexture('/x', {
        fetch: async () => new Response('no', { status: 404 }),
        decode: async () => fakeBitmap().bmp,
      }),
    ).rejects.toThrow('media 404');
  });
});
