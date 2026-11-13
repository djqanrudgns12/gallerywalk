/**
 * 템플릿마다의 3D 장면 빛과 색(PLAN §6.1·§6.3, ADR-051). 순수 데이터 — 화면 캡처와 사용자 의견(U-07)으로 맞춘다.
 *
 * - 벽·천장 조각은 구운 빛(`lightMap`, 밝기만)이 조도를 맡는다. 빛 색은 `baked.color`로 곱한다.
 * - 반구광은 구운 빛이 없는 것(액자·황동·소품·바닥)을 밝힌다. 구운 조각에는 `baked.hemisphereScale`만큼만 더해
 *   방향 치우침(위는 밝고 아래는 어두움)이 구운 빛에 겹치지 않게 한다.
 * - 환경맵은 광택·바닥 반사용으로 작게. 구운 조각에는 `baked.environmentScale`을 곱한다.
 * - 실내는 **살짝 어둡게, 작품 쪽만 은은하게 밝게**(사용자 의견 2026-11-11 밤): 방 빛(구운 빛·반구광)을 낮추고, 작품 면은
 *   조명 계산·톤 매핑 없이 제 색으로 그리며(`artMaterial`, 밝기 `art`), 작품 둘레 벽에는 빛 웅덩이(`pool`)를 더한다.
 *   광장(바깥)은 해 질 녘 빛(`outdoor`)이고, 정문을 지날 때 눈이 적응하듯 `AMBIENCE_ADAPT_SEC`에 걸쳐 바뀐다.
 * - 3D 색 체계는 화면 시안 A(숯색·상아·놋쇠, V-57 비평)를 따른다: 안내판은 숯색 판·상아 글자, 매트는 상아 계열, 먼지는 상아 한 색.
 */

/** v1은 근대 역사관만(PLAN §4.6). v1.1에 나머지 4종을 더한다. */
export const TEMPLATE_IDS = ['modern-history'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateLook {
  /** 3D 배경(먼 곳·안개) 색 */
  readonly background: string;
  /** AgX 톤 매핑 노출(실내) */
  readonly exposure: number;
  readonly baked: {
    /** `lightMapIntensity` — 구운 값 1이 받는 조도 */
    readonly intensity: number;
    /** 빛 색(sRGB 16진) */
    readonly color: string;
    readonly hemisphereScale: number;
    readonly environmentScale: number;
  };
  readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number };
  /** `scene.environmentIntensity` */
  readonly environment: number;
  /**
   * 광장(바깥) 해 질 녘 빛: 노출·반구광·환경맵·구운 빛 색(실내 `baked.color` 대신, 들어갈수록 실내 색으로)·하늘 공 색·
   * 정문 안쪽 빛(가산 판 — 실시간 조명이 아님, 광장에서 입구가 눈을 끌게). 실내 값은 위 `exposure`·`hemisphere`·`environment`
   */
  readonly outdoor: {
    readonly exposure: number;
    readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number };
    readonly environment: number;
    readonly bakedTint: string;
    readonly sky: { readonly zenith: string; readonly horizon: string; readonly ground: string };
    /**
     * 색 · 세기 · 문 앞 현관 바닥으로 번지는 길이(m) · 문 열림에서 안쪽으로 들인 거리(m) · 문 열림 대비 빛 판 크기 배율
     */
    readonly entranceGlow: {
      readonly color: string;
      readonly opacity: number;
      readonly spillM: number;
      readonly insideM: number;
      readonly spread: number;
    };
  };
  /** 작품 둘레 벽 빛 웅덩이(스포트 대신, 가산): 색·세기·액자 바깥 크기 대비 배율·위로 치우침(m) */
  readonly pool: {
    readonly color: string;
    readonly opacity: number;
    readonly scale: number;
    readonly lift: number;
  };
  /**
   * 면 색 곱(조각 재질 칸 `M_<이름>`의 바탕색에 곱함, sRGB). 질감 결은 그대로 두고 색·밝기만 분위기에 맞춘다.
   * 없는 칸은 질감 그대로.
   */
  readonly surfaces: Partial<Readonly<Record<SurfaceSlot, string>>>;
  /**
   * 면 마감(조각 재질 칸): 거칠기를 이 값으로, 환경맵 반사 세기에 `environmentScale`을 곱한다.
   * 구운 빛이 없는 광택 바닥이 밝은 환경맵을 비춰 회색 판처럼 보이던 것을 누른다(V-57).
   */
  readonly finish: Partial<
    Readonly<Record<SurfaceSlot, { readonly roughness: number; readonly environmentScale: number }>>
  >;
  /**
   * 작품 면 밝기(톤 매핑 없이 그림 색에 곱함): 가운데 · 가장자리. 빛 중심이 작품 가운데라 위아래가 고르다.
   */
  readonly art: { readonly center: number; readonly edge: number };
  /**
   * 액자: 나무 테 색 · 안쪽 놋쇠 띠 색 · 이젤 뒤판 색 · 나무 테가 차지하는 비율(테 폭 `frameBorderM` 중, 나머지는 매트로 채움 —
   * 배치 치수는 그대로) · 매트 밝기(조명 계산 없이 매트 색에 곱함, 작품 면 `art.center`보다 낮게)
   */
  readonly frame: {
    readonly wood: string;
    readonly lip: string;
    readonly back: string;
    readonly faceRatio: number;
    readonly matLight: number;
  };
  /** 안내판(출구·입구 현판·이름판) 판 면 색. 글자는 상아(`SignTexts`), 테는 놋쇠(조각 `M_Brass`) */
  readonly signFace: string;
  /** 먼지 빛 색(`MicroMotion`) */
  readonly dust: string;
  /** 매트 색(PRD 6.5): 작품 가장자리가 밝으면(`MAT_DARK_EDGE_LUMA` 이상) 어두운 쪽 — 작품이 매트에 묻히지 않게 */
  readonly mat: { readonly light: string; readonly dark: string };
  /**
   * 글 카드·소리 명판(PRD 6.8, PLAN §5.7): 기기가 캔버스로 그리는 종이 카드 색(sRGB 16진).
   * 종이 · 본문 글자 · 작가·보조 글자 · 제목 아래 선·테두리
   */
  readonly card: {
    readonly paper: string;
    readonly ink: string;
    readonly inkSub: string;
    readonly rule: string;
  };
}

/** 조각 재질 칸(tools/assets/spec/modules.md) — 분위기가 색을 바꿀 수 있는 면 */
export const SURFACE_SLOTS = ['Plaster', 'Panel', 'Floor', 'Molding', 'Ceiling', 'Marble'] as const;
export type SurfaceSlot = (typeof SURFACE_SLOTS)[number];

/** 재질 이름(`M_Plaster__mh_wall_4m` 등) → 칸 */
export const surfaceSlotOf = (materialName: string): SurfaceSlot | null => {
  const m = /^M_([A-Za-z]+)/.exec(materialName);
  const slot = m?.[1];
  return slot && (SURFACE_SLOTS as readonly string[]).includes(slot) ? (slot as SurfaceSlot) : null;
};

/**
 * 실내 분위기 시안(R-9a, `.local/art/r9/`): A 저녁 미술관 · B 고전 박물관 · C 현대 갤러리 · D 어두운 전시관.
 * 기본은 D(U-19-10, 2026-11-13 사용자 결정: "전체적으로 검정 톤, 작품 쪽과 드문드문 조명, 전시관처럼").
 * 바깥(광장) 빛·매트 색·액자·안내판·먼지는 모두 같다.
 */
export const MOOD_IDS = ['a', 'b', 'c', 'd'] as const;
export type MoodId = (typeof MOOD_IDS)[number];
export const DEFAULT_MOOD: MoodId = 'd';

/** 해 질 녘(V-57): 낮빛 베이지 석조가 평평하게 보이던 것을 낮추고, 정문 안쪽 따뜻한 빛이 시선을 끌게 */
const OUTDOOR: TemplateLook['outdoor'] = {
  exposure: 0.85,
  hemisphere: { sky: '#aeb1c4', ground: '#3b322b', intensity: 0.95 },
  environment: 0.28,
  bakedTint: '#9a908d',
  sky: { zenith: '#232a3d', horizon: '#c39a7c', ground: '#3a4630' },
  entranceGlow: { color: '#ffd7a3', opacity: 0.6, spillM: 2.6, insideM: 0.6, spread: 1.4 },
};
/** 매트는 상아 계열(V-57): 가장자리가 밝은 작품은 한 단계 짙은 상아 돌색 — 작품이 매트에 묻히지 않게 */
const MAT: TemplateLook['mat'] = { light: '#f3eee3', dark: '#b9ae9c' };
const FRAME: TemplateLook['frame'] = {
  wood: '#2b1d15',
  lip: '#a8854e',
  back: '#3a2a1e',
  faceRatio: 0.6,
  matLight: 0.86,
};
const ART: TemplateLook['art'] = { center: 1.0, edge: 0.95 };
/** 숯색 판(시안 A `--surface` 계열) */
const SIGN_FACE = '#2b2724';
/** 상아 한 색 */
const DUST = '#f3eee3';
const SHARED = {
  outdoor: OUTDOOR,
  mat: MAT,
  frame: FRAME,
  art: ART,
  signFace: SIGN_FACE,
  dust: DUST,
} as const;
/** 근대 역사관: 누렇게 바랜 한지 같은 종이 · 먹색 글자 · 놋쇠 선 */
const CARD: TemplateLook['card'] = { paper: '#f2e9d6', ink: '#2b251f', inkSub: '#5e5246', rule: '#8f7044' };

export const templateMoods: Readonly<Record<TemplateId, Readonly<Record<MoodId, TemplateLook>>>> = {
  'modern-history': {
    // A 저녁 미술관: 따뜻한 회색 벽·훈연 호두 징두리·짙은 참나무 빛 바닥, 방 : 작품 ≈ 1 : 3
    a: {
      background: '#0f0c0a',
      exposure: 1.0,
      baked: { intensity: 1.9, color: '#f3e6d4', hemisphereScale: 0.12, environmentScale: 0.3 },
      hemisphere: { sky: '#efe4d4', ground: '#2a211b', intensity: 0.42 },
      environment: 0.22,
      ...SHARED,
      pool: { color: '#ffddb2', opacity: 0.62, scale: 1.75, lift: 0.22 },
      surfaces: {
        Plaster: '#8f8a82',
        Panel: '#6e5a4a',
        Floor: '#6a5646',
        Molding: '#7d6b5a',
        Ceiling: '#8a8781',
        Marble: '#b3ada2',
      },
      finish: {},
      card: CARD,
    },
    // B 고전 박물관: 밝은 회반죽·석회석 바닥, 천창 낮빛, 방 : 작품 ≈ 1 : 1.8
    b: {
      background: '#1a1714',
      exposure: 1.0,
      baked: { intensity: 2.9, color: '#eef0ec', hemisphereScale: 0.15, environmentScale: 0.35 },
      hemisphere: { sky: '#eef0ec', ground: '#4a443c', intensity: 0.8 },
      environment: 0.38,
      ...SHARED,
      pool: { color: '#ffddb2', opacity: 0.38, scale: 1.6, lift: 0.18 },
      surfaces: { Panel: '#b39c84', Floor: '#cfcabf', Molding: '#c9bba8' },
      finish: {},
      card: CARD,
    },
    // C 현대 갤러리: 깊은 녹색 벽·회색 콘크리트 바닥, 트랙 스포트, 방 : 작품 ≈ 1 : 3.5
    c: {
      background: '#0b0f0d',
      exposure: 1.0,
      baked: { intensity: 2.1, color: '#ece8de', hemisphereScale: 0.12, environmentScale: 0.3 },
      hemisphere: { sky: '#e4e0d5', ground: '#25302b', intensity: 0.48 },
      environment: 0.22,
      ...SHARED,
      pool: { color: '#ffe7c8', opacity: 0.66, scale: 1.8, lift: 0.22 },
      surfaces: {
        Plaster: '#3d5e52',
        Panel: '#5e5246',
        Floor: '#8e908b',
        Molding: '#53625b',
        Ceiling: '#5c6b64',
        Marble: '#5a6a63',
      },
      finish: {},
      card: CARD,
    },
    // D 어두운 전시관(U-19-10): 숯색 벽·짙은 바닥·낮은 방 빛, 작품마다 스포트처럼 강한 빛 웅덩이, 방 : 작품 ≈ 1 : 6
    d: {
      background: '#0b0a09',
      exposure: 0.95,
      baked: { intensity: 0.95, color: '#e9dcc8', hemisphereScale: 0.08, environmentScale: 0.2 },
      hemisphere: { sky: '#d9cdbb', ground: '#141110', intensity: 0.22 },
      environment: 0.12,
      ...SHARED,
      // 빛 중심을 작품 가운데로(V-57: 위쪽 벽에 몰려 작품 아래가 죽어 보였다)
      pool: { color: '#ffe2b8', opacity: 0.95, scale: 1.55, lift: 0.03 },
      surfaces: {
        Plaster: '#2c2a28',
        Panel: '#211d1a',
        // 짙은 호두나무(V-57: 밝은 회색 판처럼 보였다) — 반사는 `finish`로 낮춘다
        Floor: '#3a2a1f',
        Molding: '#3b342d',
        Ceiling: '#1d1c1b',
        Marble: '#4b4743',
      },
      finish: { Floor: { roughness: 0.62, environmentScale: 0.3 } },
      card: CARD,
    },
  },
};

/** 템플릿 기본 분위기(`DEFAULT_MOOD`) */
export const templateLooks: Readonly<Record<TemplateId, TemplateLook>> = {
  'modern-history': templateMoods['modern-history'][DEFAULT_MOOD],
};

/** 그 작품의 매트 색(가장자리 밝기 모르면 밝은 쪽) */
export const matColorOf = (look: TemplateLook, edgeLuma: number | null, threshold: number): string =>
  edgeLuma !== null && edgeLuma >= threshold ? look.mat.dark : look.mat.light;
