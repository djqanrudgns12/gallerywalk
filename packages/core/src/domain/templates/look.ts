/**
 * 템플릿마다의 3D 장면 빛과 색(PLAN §6.1·§6.3, ADR-051). 순수 데이터 — 화면 캡처와 사용자 의견(U-07)으로 맞춘다.
 *
 * - 벽·천장 조각은 구운 빛(`lightMap`, 밝기만)이 조도를 맡는다. 빛 색은 `baked.color`로 곱한다.
 * - 반구광은 구운 빛이 없는 것(액자·황동·소품·바닥)을 밝힌다. 구운 조각에는 `baked.hemisphereScale`만큼만 더해
 *   방향 치우침(위는 밝고 아래는 어두움)이 구운 빛에 겹치지 않게 한다.
 * - 환경맵은 광택·바닥 반사용으로 작게. 구운 조각에는 `baked.environmentScale`을 곱한다.
 * - 실내는 **살짝 어둡게, 작품 쪽만 은은하게 밝게**(사용자 의견 2026-11-11 밤): 방 빛(구운 빛·반구광)을 낮추고, 작품 면은
 *   조명 계산 없이 제 색으로 그리며(`artMaterial`), 작품 위 벽에는 빛 웅덩이(`pool`)를 더한다. 광장(바깥)은 낮빛
 *   (`outdoor`)이고, 정문을 지날 때 눈이 적응하듯 `AMBIENCE_ADAPT_SEC`에 걸쳐 바뀐다.
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
  /** 광장(바깥) 낮빛: 노출·반구광·환경맵. 실내 값은 위 `exposure`·`hemisphere`·`environment` */
  readonly outdoor: {
    readonly exposure: number;
    readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number };
    readonly environment: number;
  };
  /** 작품 위 벽 빛 웅덩이(스포트 대신, 가산): 색·세기·액자 바깥 크기 대비 배율·위로 치우침(m) */
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
 * 실내 분위기 시안(R-9a, `.local/art/r9/`): A 저녁 미술관 · B 고전 박물관 · C 현대 갤러리.
 * 기본은 A(사용자 의견 "살짝 어둡게, 작품 쪽 은은하게 밝게"). 사용자가 고르면(U-07) `DEFAULT_MOOD`를 바꾼다.
 * 바깥(광장) 빛과 매트 색은 셋이 같다.
 */
export const MOOD_IDS = ['a', 'b', 'c'] as const;
export type MoodId = (typeof MOOD_IDS)[number];
export const DEFAULT_MOOD: MoodId = 'a';

const OUTDOOR: TemplateLook['outdoor'] = {
  exposure: 1.0,
  hemisphere: { sky: '#f4f1ea', ground: '#7a705f', intensity: 1.55 },
  environment: 0.55,
};
const MAT: TemplateLook['mat'] = { light: '#f3eee3', dark: '#3a3430' };
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
      outdoor: OUTDOOR,
      pool: { color: '#ffddb2', opacity: 0.62, scale: 1.75, lift: 0.22 },
      surfaces: {
        Plaster: '#8f8a82',
        Panel: '#6e5a4a',
        Floor: '#6a5646',
        Molding: '#7d6b5a',
        Ceiling: '#8a8781',
        Marble: '#b3ada2',
      },
      mat: MAT,
      card: CARD,
    },
    // B 고전 박물관: 밝은 회반죽·석회석 바닥, 천창 낮빛, 방 : 작품 ≈ 1 : 1.8
    b: {
      background: '#1a1714',
      exposure: 1.0,
      baked: { intensity: 2.9, color: '#eef0ec', hemisphereScale: 0.15, environmentScale: 0.35 },
      hemisphere: { sky: '#eef0ec', ground: '#4a443c', intensity: 0.8 },
      environment: 0.38,
      outdoor: OUTDOOR,
      pool: { color: '#ffddb2', opacity: 0.38, scale: 1.6, lift: 0.18 },
      surfaces: { Panel: '#b39c84', Floor: '#cfcabf', Molding: '#c9bba8' },
      mat: MAT,
      card: CARD,
    },
    // C 현대 갤러리: 깊은 녹색 벽·회색 콘크리트 바닥, 트랙 스포트, 방 : 작품 ≈ 1 : 3.5
    c: {
      background: '#0b0f0d',
      exposure: 1.0,
      baked: { intensity: 2.1, color: '#ece8de', hemisphereScale: 0.12, environmentScale: 0.3 },
      hemisphere: { sky: '#e4e0d5', ground: '#25302b', intensity: 0.48 },
      environment: 0.22,
      outdoor: OUTDOOR,
      pool: { color: '#ffe7c8', opacity: 0.66, scale: 1.8, lift: 0.22 },
      surfaces: {
        Plaster: '#3d5e52',
        Panel: '#5e5246',
        Floor: '#8e908b',
        Molding: '#53625b',
        Ceiling: '#5c6b64',
        Marble: '#5a6a63',
      },
      mat: MAT,
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
