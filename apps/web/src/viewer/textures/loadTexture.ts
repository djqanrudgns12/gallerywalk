import { LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace, Texture } from 'three';

/**
 * 작품 그림 받기(PLAN §6.5): 주소 → `fetch` → `createImageBitmap`(디코드는 브라우저가 메인 스레드 밖에서) → `Texture`.
 * - `ImageBitmap`은 `Texture.flipY`가 무시되므로 UV 변환(repeat.y = −1, offset.y = 1)으로 위아래를 맞춘다(기하를 건드리지 않음).
 * - 알파는 미리 곱해 받고(`premultiplyAlpha: 'premultiply'`) 텍스처에 그렇게 알린다 — 투명 작품이 매트 색 위에 깨끗하게.
 * - 해제(`dispose`)할 때 `ImageBitmap.close()`까지(GPU·메모리 둘 다).
 */

export class BitmapTexture extends Texture {
  private bitmap: ImageBitmap | null;

  constructor(bitmap: ImageBitmap) {
    super(bitmap);
    this.bitmap = bitmap;
    this.flipY = false;
    this.repeat.set(1, -1);
    this.offset.set(0, 1);
    this.premultiplyAlpha = true;
    this.colorSpace = SRGBColorSpace;
    this.generateMipmaps = true;
    this.minFilter = LinearMipmapLinearFilter;
    this.magFilter = LinearFilter;
    this.anisotropy = 4;
    this.needsUpdate = true;
  }

  override dispose(): void {
    super.dispose();
    this.bitmap?.close();
    this.bitmap = null;
  }
}

export interface LoadDeps {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly decode: (blob: Blob) => Promise<ImageBitmap>;
}

export const browserLoadDeps = (): LoadDeps => ({
  fetch: (url, init) => fetch(url, init),
  decode: blob => createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' }),
});

/** 주소 하나 → 텍스처. 응답이 실패면 거절(상주 관리가 'failed'로 둠) */
export const loadArtworkTexture = async (
  url: string,
  deps: LoadDeps,
  signal?: AbortSignal,
): Promise<BitmapTexture> => {
  const res = await deps.fetch(url, signal ? { signal, credentials: 'omit' } : { credentials: 'omit' });
  if (!res.ok) throw new Error(`media ${res.status}`);
  const bitmap = await deps.decode(await res.blob());
  return new BitmapTexture(bitmap);
};
