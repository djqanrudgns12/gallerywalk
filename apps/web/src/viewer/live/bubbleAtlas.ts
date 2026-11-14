import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';

/**
 * 말풍선 아틀라스(PRD_V2 W-02, `Bubbles.tsx`가 씀).
 * - 스티커: 4열 × 3줄 칸. M4-1 최종 그림(`stk-1/` KTX2)이 오기 전에는 **임시 칸**(상아 원 + 스티커 이름 글자 + 작은 꼬리)을 캔버스로
 *   그린다 — 이모지·운영체제 글꼴 그림은 쓰지 않는다. 칸 순서는 `copy.bubble.stickers`와 같다.
 * - 말: 정해진 말·짧은 글을 칸마다 상아 둥근 풍선 + 숯색 글자 + 꼬리로 그린다. 같은 글은 칸을 나눠 쓰고, 이번 장면에 쓰지 않는
 *   칸부터 다시 쓴다(`SlotCache`). 칸이 모자라면 그 말풍선은 이번 장면에 숨긴다.
 */

export const STICKER_COLS = 4;
export const STICKER_ROWS = 3;
export const STICKER_CELL = 256;
export const TEXT_ATLAS_W = 1024;
export const TEXT_SLOT_W = 512;
export const TEXT_SLOT_H = 128;
export const TEXT_SLOTS = 16;
const TEXT_COLS = TEXT_ATLAS_W / TEXT_SLOT_W;
/** 말 글자 크기(px, 칸 높이 128 중) — 글자 높이 / 풍선 높이 = `TEXT_GLYPH_RATIO`(화면 최소 글자 크기 계산에 씀) */
const TEXT_FONT_PX = 46;
export const TEXT_GLYPH_RATIO = TEXT_FONT_PX / TEXT_SLOT_H;
const FONT = '"Pretendard", "Apple SD Gothic Neo", sans-serif';

/** 아틀라스 안 네모(0~1 UV, 캔버스는 위가 v=1 — `CanvasTexture.flipY`) · 가로/세로 비 */
export interface AtlasRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly aspect: number;
}

/** 스티커 `i`번 칸 */
export const stickerRect = (i: number): AtlasRect => {
  const col = i % STICKER_COLS;
  const row = Math.floor(i / STICKER_COLS);
  return {
    u0: col / STICKER_COLS,
    u1: (col + 1) / STICKER_COLS,
    v0: 1 - (row + 1) / STICKER_ROWS,
    v1: 1 - row / STICKER_ROWS,
    aspect: 1,
  };
};

/**
 * 칸 나눠 쓰기(순수): 같은 열쇠는 같은 칸. 새 열쇠는 빈 칸, 없으면 이번 장면(`frame`)에 쓰지 않은 칸 중 가장 오래 안 쓴 칸.
 * 모두 이번 장면에 쓰는 중이면 null.
 */
export class SlotCache {
  private readonly byKey = new Map<string, { slot: number; used: number }>();
  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: string, frame: number): { slot: number; fresh: boolean } | null {
    const hit = this.byKey.get(key);
    if (hit) {
      hit.used = frame;
      return { slot: hit.slot, fresh: false };
    }
    const taken = new Set([...this.byKey.values()].map(v => v.slot));
    let slot = -1;
    for (let s = 0; s < this.capacity; s++)
      if (!taken.has(s)) {
        slot = s;
        break;
      }
    if (slot < 0) {
      let oldKey: string | null = null;
      let oldUsed = Infinity;
      for (const [k, v] of this.byKey)
        if (v.used < frame && v.used < oldUsed) {
          oldKey = k;
          oldUsed = v.used;
        }
      if (oldKey === null) return null;
      slot = this.byKey.get(oldKey)!.slot;
      this.byKey.delete(oldKey);
    }
    this.byKey.set(key, { slot, used: frame });
    return { slot, fresh: true };
  }

  clear(): void {
    this.byKey.clear();
  }
}

/** 둥근 네모 길(옛 iPad Safari에는 `roundRect`가 없어 호로 — `Peers.tsx` 이름표와 같음) */
const roundedPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
};

/** 임시 스티커 아틀라스(M4-1 그림이 오면 바꾼다) */
export const drawPlaceholderStickers = (canvas: HTMLCanvasElement): void => {
  canvas.width = STICKER_COLS * STICKER_CELL;
  canvas.height = STICKER_ROWS * STICKER_CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const l = config().BUBBLE_LOOK;
  const names = copy.bubble.stickers;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < config().BUBBLE_STICKERS; i++) {
    const cx = (i % STICKER_COLS) * STICKER_CELL + STICKER_CELL / 2;
    const top = Math.floor(i / STICKER_COLS) * STICKER_CELL;
    const r = STICKER_CELL * 0.4;
    const cy = top + STICKER_CELL * 0.45;
    ctx.fillStyle = l.paper;
    ctx.strokeStyle = l.edge;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 작은 꼬리(아래 가운데)
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy + r - 6);
    ctx.lineTo(cx, cy + r + 22);
    ctx.lineTo(cx + 16, cy + r - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = l.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 44px ${FONT}`;
    ctx.fillText(names[i] ?? '', cx, cy + 2, r * 1.7);
  }
};

/** 말 칸 하나를 그리고 그 풍선이 차지한 네모를 돌려준다 */
export const drawTextSlot = (canvas: HTMLCanvasElement, slot: number, text: string): AtlasRect => {
  const x = (slot % TEXT_COLS) * TEXT_SLOT_W;
  const y = Math.floor(slot / TEXT_COLS) * TEXT_SLOT_H;
  const tail = 18;
  const bodyH = TEXT_SLOT_H - tail - 6;
  let w = TEXT_SLOT_W - 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const l = config().BUBBLE_LOOK;
    ctx.clearRect(x, y, TEXT_SLOT_W, TEXT_SLOT_H);
    ctx.font = `600 ${TEXT_FONT_PX}px ${FONT}`;
    w = Math.min(TEXT_SLOT_W - 8, Math.max(bodyH, ctx.measureText(text).width + 64));
    const left = x + (TEXT_SLOT_W - w) / 2;
    const top = y + 3;
    roundedPath(ctx, left, top, w, bodyH, bodyH / 2);
    ctx.fillStyle = l.paper;
    ctx.fill();
    ctx.strokeStyle = l.edge;
    ctx.lineWidth = 3;
    ctx.stroke();
    // 꼬리(아래 가운데, 테두리 위를 덮어 이어지게)
    const cx = x + TEXT_SLOT_W / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 14, top + bodyH - 2);
    ctx.lineTo(cx, top + bodyH + tail);
    ctx.lineTo(cx + 14, top + bodyH - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = l.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, top + bodyH / 2 + 2, w - 40);
  }
  const left = x + (TEXT_SLOT_W - w) / 2;
  const rows = TEXT_SLOTS / TEXT_COLS;
  const H = rows * TEXT_SLOT_H;
  return {
    u0: left / TEXT_ATLAS_W,
    u1: (left + w) / TEXT_ATLAS_W,
    v0: 1 - (y + TEXT_SLOT_H) / H,
    v1: 1 - y / H,
    aspect: w / TEXT_SLOT_H,
  };
};

export const textAtlasHeight = (): number => (TEXT_SLOTS / TEXT_COLS) * TEXT_SLOT_H;
