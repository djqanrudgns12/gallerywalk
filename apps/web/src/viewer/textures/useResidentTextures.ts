import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Texture } from 'three';
import { browserLoadDeps, loadArtworkTexture } from './loadTexture.ts';
import {
  budgetBytes,
  type Focus,
  Residency,
  type ResidentArt,
  type Tier,
  type Variant,
  wantedVariants,
} from './residency.ts';

/**
 * 상주 관리(§6.5)를 장면에 붙인다(P4-2). Canvas 안에서 부른다.
 * - 원하는 집합은 `focus`(그리는 관·지금 관·가까운 작품·안내 목적지)가 바뀔 때만 다시 계산한다.
 * - 올리기는 프레임마다 하나(`renderer.initTexture`). 남았으면 다음 프레임을 깨운다 — 멈추면 다시 그리지 않는다.
 * - 내린 텍스처는 바로 지우지 않고 잠시 뒤에 지운다: 같은 프레임에 아직 옛 재질이 그 텍스처를 그리고 있을 수 있고
 *   (`ImageBitmap`을 닫은 뒤 그리면 three가 닫힌 그림을 다시 올리려 한다), React가 새 재질로 바꾼 뒤면 안전하다.
 */

export interface ArtworkTextureSource {
  readonly arts: readonly ResidentArt[];
  /** 작품 ID·변형 → 미디어 주소(없으면 null) */
  readonly urlOf: (artworkId: string, variant: Variant) => string | null;
}

/** 내린 텍스처를 실제로 지우기까지(ms) — React가 새 재질로 바꿀 시간 */
const DISPOSE_DELAY_MS = 1500;

class Held {
  readonly tex: Texture;
  constructor(tex: Texture) {
    this.tex = tex;
  }
  dispose(): void {
    const t = this.tex;
    window.setTimeout(() => t.dispose(), DISPOSE_DELAY_MS);
  }
}

const focusKey = (f: Focus): string =>
  `${[...f.visibleParts].sort().join(',')}|${f.partId ?? ''}|${f.nearestId ?? ''}|${f.targetId ?? ''}`;

export interface ResidentTextures {
  readonly ready: boolean;
  /** 바뀔 때마다 1씩 — 작품 목록을 다시 만들 때 쓴다 */
  readonly version: number;
  readonly textureOf: (artworkId: string) => Texture | null;
}

export const useResidentTextures = (
  source: ArtworkTextureSource | null,
  focus: Focus,
  tier: Tier,
): ResidentTextures => {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  const [version, setVersion] = useState(0);

  // StrictMode가 효과를 두 번 돌려도 지운 관리자를 다시 쓰지 않게 효과 안에서 만든다
  const [residency, setResidency] = useState<Residency<Held> | null>(null);
  useEffect(() => {
    if (!source) {
      setResidency(null);
      return;
    }
    const deps = browserLoadDeps();
    const r = new Residency<Held>({
      load: async (id, v) => {
        const url = source.urlOf(id, v);
        if (!url) throw new Error('no media');
        return new Held(await loadArtworkTexture(url, deps));
      },
      upload: h => gl.initTexture(h.tex),
      onChange: () => {
        setVersion(v => v + 1);
        invalidate();
      },
      budget: budgetBytes(tier),
    });
    r.setArtworks(source.arts);
    setResidency(r);
    return () => r.dispose();
  }, [source, gl, tier, invalidate]);

  const key = focusKey(focus);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const wanted = useMemo(
    () =>
      source
        ? wantedVariants(source.arts, focusRef.current, tier, gl.capabilities.maxTextureSize)
        : new Map<string, Variant>(),
    [source, key, tier, gl],
  );
  useEffect(() => {
    if (!residency || !source) return;
    residency.update(wantedVariants(source.arts, focusRef.current, tier, gl.capabilities.maxTextureSize));
    invalidate();
  }, [residency, source, key, tier, gl, invalidate]);
  // 끊겼다 이어지면(제자리에 서 있어도) 받지 못한 그림을 다시 받는다 — 간격·횟수는 `Residency`가 본다
  useEffect(() => {
    if (!residency || !source) return;
    const again = (): void => {
      residency.update(wantedVariants(source.arts, focusRef.current, tier, gl.capabilities.maxTextureSize));
      invalidate();
    };
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [residency, source, tier, gl, invalidate]);

  useFrame(() => {
    if (residency?.tick()) invalidate();
  });

  return useMemo(
    () => ({
      version,
      ready: source === null || (residency?.settled(wanted) ?? false),
      textureOf: (id: string) => residency?.textureOf(id)?.tex.tex ?? null,
    }),
    [version, residency, source, wanted],
  );
};
