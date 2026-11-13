import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CustomBlending,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderChunk,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * 재질 도우미(PLAN §6.1·§6.3).
 *
 * - **장면 어둡게** `uDim`: 모든 재질의 마지막 색에 곱한다. 줌에서 주변을 70%로(PRD 8.2).
 * - 작품마다 자기 `DimHolder`를 갖고, 줌 대상은 1에 머물고 나머지는 장면 값을 따른다.
 * - 셰이더 조각은 `dithering_fragment` 뒤(톤 매핑·색 공간 변환 다음)에 넣어 화면 밝기 기준으로 어둡게 한다.
 * - **구운 조각**(ADR-051): 구운 빛(`lightMap`, 밝기만)에 빛 색 `uBakedTint`를 곱하고, 반구광은
 *   `uBakedHemisphere`만큼만 더한다(구운 빛에 이미 위아래 밝기 차가 들어 있어 두 번 겹치지 않게).
 */

export interface DimHolder {
  value: number;
}

/** 벽·바닥·천장처럼 늘 장면 값을 따르는 재질이 함께 쓰는 값 */
export const sceneDim: DimHolder = { value: 1 };

/** 구운 조각이 함께 쓰는 값. 템플릿 장면 빛(`Stage`)이 채운다. */
export const bakedLight = {
  tint: { value: new Color(1, 1, 1) },
  hemisphere: { value: 1 },
};

const patched = (chunk: string, from: string, to: string): string => {
  const out = chunk.replace(from, to);
  // three 판이 바뀌어 조각 문자열이 달라지면 조용히 넘어가지 않고 바로 알린다.
  if (out === chunk) throw new Error(`셰이더 조각을 찾지 못함: ${from}`);
  return out;
};

const BAKED_MAPS = patched(
  ShaderChunk.lights_fragment_maps,
  'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
  'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity * uBakedTint;',
);
const BAKED_BEGIN = patched(
  ShaderChunk.lights_fragment_begin,
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
  'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * uBakedHemisphere;',
);

type Variant = 'plain' | 'art' | 'baked' | 'pool';

const injectDim = (
  material: Material,
  holder: DimHolder,
  variant: Variant,
  extra = '',
  uniforms: Readonly<Record<string, DimHolder>> = {},
): void => {
  material.onBeforeCompile = shader => {
    shader.uniforms['uDim'] = holder;
    let header = 'uniform float uDim;\n';
    for (const [name, u] of Object.entries(uniforms)) {
      shader.uniforms[name] = u;
      header += `uniform float ${name};\n`;
    }
    let fragment = shader.fragmentShader;
    if (variant === 'baked') {
      shader.uniforms['uBakedTint'] = bakedLight.tint;
      shader.uniforms['uBakedHemisphere'] = bakedLight.hemisphere;
      header += 'uniform vec3 uBakedTint;\nuniform float uBakedHemisphere;\n';
      fragment = fragment
        .replace('#include <lights_fragment_maps>', BAKED_MAPS)
        .replace('#include <lights_fragment_begin>', BAKED_BEGIN);
    }
    shader.fragmentShader = fragment
      .replace('void main() {', `${header}void main() {`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\n${extra}\ngl_FragColor.rgb *= uDim;`,
      );
  };
  // 같은 셰이더를 쓰는 재질끼리는 프로그램을 나눠 쓴다.
  material.customProgramCacheKey = () => `gw-dim-${variant}`;
};

export const withDim = <T extends Material>(material: T, holder: DimHolder = sceneDim): T => {
  injectDim(material, holder, 'plain');
  return material;
};

/** 구운 빛을 받는 템플릿 조각 재질(`TemplateModules`). */
export const withBakedLight = <T extends Material>(material: T, holder: DimHolder = sceneDim): T => {
  injectDim(material, holder, 'baked');
  return material;
};

/** 작품 면 밝기(템플릿 `look.art`): 가운데 · 가장자리 */
export interface ArtLight {
  readonly center: number;
  readonly edge: number;
}

/**
 * 작품 면: 조명 계산·톤 매핑 없이 그림 색 × 가운데가 가장 밝고 가장자리로 조금 낮아지는 밝기(빛 웅덩이 중심과 맞춤).
 * 톤 매핑을 거치면 흰 바탕이 회갈색으로 죽고(V-57), 크게 보기 HTML 층의 같은 그림과 색이 달라진다.
 * 밝기는 가운데 대칭이라 UV 뒤집기(`ImageBitmap` 상주 관리, P4-2)와 상관없다.
 * 투명한 곳(PNG 그림의 빈 자리)은 바로 뒤(4mm)의 매트가 비친다 — 불투명으로 그리면 검게 나왔다(P4 시드에서 발견).
 * 미리 곱한 알파(`ImageBitmap`)는 `ONE, ONE_MINUS_SRC_ALPHA`로 섞어 가장자리를 두 번 곱하지 않는다.
 */
export const artMaterial = (map: Texture, holder: DimHolder, light: ArtLight): MeshBasicMaterial => {
  map.colorSpace = SRGBColorSpace;
  const premultiplied = map.premultiplyAlpha;
  const material = new MeshBasicMaterial({
    map,
    toneMapped: false,
    transparent: true,
    ...(premultiplied
      ? {
          blending: CustomBlending,
          blendSrc: OneFactor,
          blendDst: OneMinusSrcAlphaFactor,
          blendSrcAlpha: OneFactor,
          blendDstAlpha: OneMinusSrcAlphaFactor,
        }
      : {}),
  });
  // 가운데에서 잰 거리(네 모서리 = 1)로 가장자리 밝기까지. 판 크기와 상관없이 같은 셰이더(값은 uniform)
  injectDim(
    material,
    holder,
    'art',
    `{ vec2 gwD = (vMapUv - 0.5) * 2.0; gl_FragColor.rgb *= mix(uArtCenter, uArtEdge, clamp(dot(gwD, gwD) * 0.5, 0.0, 1.0)); }`,
    { uArtCenter: { value: light.center }, uArtEdge: { value: light.edge } },
  );
  return material;
};

/**
 * 매트 면: 조명 계산·톤 매핑 없이 매트 색 × `light`(템플릿 `look.frame.matLight`). 어두운 방의 반구광으로 그리면
 * 상아 매트가 검게 죽어 액자 안에 검은 판이 또 있는 것처럼 보였다(V-57). 작품 면보다 한 단계 낮게 둔다.
 */
export const matMaterial = (color: string, light: number, holder: DimHolder): MeshBasicMaterial => {
  const material = new MeshBasicMaterial({ color, toneMapped: false });
  material.color.multiplyScalar(light);
  return withDim(material, holder);
};

export const standard = (
  params: ConstructorParameters<typeof MeshStandardMaterial>[0],
  holder: DimHolder = sceneDim,
): MeshStandardMaterial => withDim(new MeshStandardMaterial(params), holder);

/** 빛 웅덩이 모양·색(템플릿 `look.pool`) */
export interface PoolStyle {
  readonly color: string;
  readonly opacity: number;
  readonly scale: number;
  readonly lift: number;
}

export const DEFAULT_POOL: PoolStyle = { color: '#ffe2b8', opacity: 0.32, scale: 1.6, lift: 0.15 };

/**
 * 부드러운 둥근 빛(빛 웅덩이). 가산 혼합.
 * `boost`(작품마다 하나)는 마우스 올림·크게 보기·빛 흔들림 배율(V-40, `MicroMotion`) — 값만 바꾸고 셰이더는 그대로.
 */
export const lightPoolMaterial = (
  holder: DimHolder,
  style: PoolStyle = DEFAULT_POOL,
  boost: DimHolder = { value: 1 },
): MeshBasicMaterial => {
  const material = new MeshBasicMaterial({
    map: radialTexture(),
    color: style.color,
    transparent: true,
    opacity: style.opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  injectDim(material, holder, 'pool', 'gl_FragColor.rgb *= uBoost;', { uBoost: boost });
  return material;
};

/** 빛 웅덩이 밝기 단계(가운데 0 → 가장자리 1): 거리 · 밝기 */
const POOL_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.35, 0.78],
  [0.7, 0.25],
  [1, 0],
];

const poolFalloff = (r: number): number => {
  for (let i = 1; i < POOL_STOPS.length; i++) {
    const [r1, v1] = POOL_STOPS[i]!;
    const [r0, v0] = POOL_STOPS[i - 1]!;
    if (r <= r1) return v0 + ((v1 - v0) * (r - r0)) / (r1 - r0);
  }
  return 0;
};

/**
 * 사람 발밑 그늘(내 캐릭터·다른 관람객 인스턴스 공용): 가운데가 짙고 가장자리로 부드럽게 사라지는 원판.
 * 실시간 그림자 없이(AGENTS.md §4) 발이 바닥에 닿아 보이게. 바닥 위 살짝 띄우고 깊이 쓰기는 하지 않는다.
 */
export const blobShadowMaterial = (opacity: number, holder: DimHolder = sceneDim): MeshBasicMaterial =>
  withDim(
    new MeshBasicMaterial({
      alphaMap: softDiscTexture(),
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    holder,
  );

let discCache: CanvasTexture | null = null;
const softDiscTexture = (): CanvasTexture => {
  if (discCache) return discCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 알파 맵은 초록 채널을 읽는다 — 흰색 단계로 짙기를 그린다(발 닿는 가운데 짙게, 바깥은 넓고 옅게)
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgb(255,255,255)');
    g.addColorStop(0.28, 'rgb(225,225,225)');
    g.addColorStop(0.55, 'rgb(110,110,110)');
    g.addColorStop(0.82, 'rgb(28,28,28)');
    g.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  discCache = new CanvasTexture(canvas);
  return discCache;
};

/** 액자 뒤 흐린 그림자(접촉 그림자). 9-slice 대신 시험용으로 흐린 사각형 한 장 */
export const contactShadowMaterial = (holder: DimHolder): MeshBasicMaterial =>
  withDim(
    new MeshBasicMaterial({
      alphaMap: blurredRectTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
    holder,
  );

let radialCache: DataTexture | null = null;
/**
 * 빛 웅덩이 모양: 가운데가 가장 밝고 둘레로 부드럽게 사라지는 원(작품 가운데가 빛 중심, V-57).
 * 캔버스 그라데이션 대신 계산한 회색 값(세 채널 같음, 알파 1)으로 만든다 — 캔버스의 미리 곱한 알파를 되돌릴 때와
 * 그라데이션 떨림에서 채널마다 다른 오차가 생겨, 밝은 웅덩이 안에 분홍·초록·파랑 점이 보였다(V-57).
 * 가산 혼합(SRC_ALPHA, ONE)에서 알파는 재질 `opacity`라 밝기는 전과 같다: 색 × 값 × 세기.
 */
const radialTexture = (): DataTexture => {
  if (radialCache) return radialCache;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const v = Math.round(poolFalloff(Math.min(1, r)) * 255);
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  const tex = new DataTexture(data, size, size);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  radialCache = tex;
  return radialCache;
};

let rectCache: CanvasTexture | null = null;
const blurredRectTexture = (): CanvasTexture => {
  if (rectCache) return rectCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.filter = 'blur(22px)';
    ctx.fillStyle = '#fff';
    ctx.fillRect(size * 0.16, size * 0.16, size * 0.68, size * 0.68);
  }
  rectCache = new CanvasTexture(canvas);
  return rectCache;
};
