import { create } from 'zustand';

/**
 * 도슨트 대사 상태(PRD_V2 W-10, M4-7·M4-8). 3D 도슨트(`Docents.tsx`)가 쓰고, 바깥 DOM(대사 카드·머리 위 말풍선)이 읽는다.
 * 값이 바뀔 때만 쓴다 — 말풍선 자리는 `docentTuning().bubbleMovePx` 넘게 움직였을 때만.
 */

export interface DocentTalkView {
  readonly npcId: string;
  /** 줄 번호(1부터) */
  readonly line: number;
  readonly text: string;
  /** 시작 시각(초, 단조 시계) — 바뀌면 새 대사 */
  readonly at: number;
}

export interface DocentBubbleView {
  readonly npcId: string;
  /** `tip` = 이따금 한마디 · `talk` = 말걸기 대사(카드와 함께) */
  readonly kind: 'tip' | 'talk';
  readonly line: number;
  readonly text: string;
  readonly at: number;
  /** 머리 위 자리(CSS px, 캔버스 왼쪽 위 기준) — 말풍선 꼬리 끝이 여기 */
  readonly x: number;
  readonly y: number;
  /** 카메라 앞이고 화면 안인가(아니면 숨김) */
  readonly onScreen: boolean;
}

interface DocentSpeechState {
  talk: DocentTalkView | null;
  bubble: DocentBubbleView | null;
  /** 대사 카드의 닫기: 말걸기 대사와 그 말풍선을 지운다(3D 도슨트가 듣고 행동도 닫음) */
  closeTalk: () => void;
}

export const useDocentSpeech = create<DocentSpeechState>(set => ({
  talk: null,
  bubble: null,
  closeTalk: () => set(s => ({ talk: null, bubble: s.bubble?.kind === 'talk' ? null : s.bubble })),
}));
