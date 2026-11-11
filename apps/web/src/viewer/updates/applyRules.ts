import { config } from '@gallery/core/config';
import { canonicalJson } from '@gallery/core/layout';
import type { ExhibitionStatus, Layout, Stop } from '@gallery/core/types';

/**
 * 전시 바뀜 확인·적용 규칙(P4-9, ADR-027, PLAN §7.3). 순수 함수 — 화면(관람 상태)이 부르고 결과대로 움직인다.
 *
 * - `GET /api/e/{code}/v`를 `CHANGE_POLL_SEC`(60초)마다·화면 복귀 때 확인한다(`shouldPoll`).
 * - 닫힘·준비 중이면 그 화면으로, 배치가 그대로면(내용·설정만) 조용히 새로 받아 반영.
 * - 배치가 바뀌었으면: **지금 있는 관이 그대로면** 다음 이동 때 조용히 새 배치로, 아니면 위 띠
 *   "전시가 새로 바뀌었어요 `새로 보기`"(수업 중 학생이 보던 방이 갑자기 바뀌지 않게).
 * - `새로 보기`: 보던 작품으로 다시 감 → 그 작품이 없어졌으면 같은 관의 소개 → 그것도 없으면 입구 홀.
 */

export interface Versions {
  readonly layoutVersion: number;
  readonly contentVersion: number;
  readonly settingsVersion: number;
}

export type UpdateAction =
  /** 바뀐 것 없음 */
  | { readonly kind: 'NONE' }
  /** 막 내림 화면 */
  | { readonly kind: 'CLOSED' }
  /** 준비 중 화면(교사가 다시 준비로 돌림) */
  | { readonly kind: 'NOT_READY' }
  /** 보기 묶음을 새로 받아야 함(그 뒤 `decideLayoutApply`로 적용 방법을 고른다) */
  | { readonly kind: 'REFETCH'; readonly layoutChanged: boolean };

/** 버전 확인 결과 → 할 일 */
export const decideUpdate = (
  current: Versions,
  next: Versions & { readonly status: ExhibitionStatus },
): UpdateAction => {
  if (next.status === 'CLOSED') return { kind: 'CLOSED' };
  if (next.status === 'DRAFT') return { kind: 'NOT_READY' };
  const layoutChanged = next.layoutVersion !== current.layoutVersion;
  if (
    !layoutChanged &&
    next.contentVersion === current.contentVersion &&
    next.settingsVersion === current.settingsVersion
  )
    return { kind: 'NONE' };
  return { kind: 'REFETCH', layoutChanged };
};

/** 관 하나의 모양 서명: 관 자체·그 관의 액자·명판·설비·조각. 같으면 학생 눈에 그 관은 그대로다. */
export const partSignature = (layout: Layout, partId: string): string | null => {
  const part = layout.parts.find(p => p.partId === partId);
  if (!part) return null;
  const artIds = new Set(layout.frames.filter(f => f.partId === partId).map(f => f.artworkId));
  return canonicalJson({
    part,
    frames: layout.frames.filter(f => f.partId === partId),
    labels: layout.labels.filter(l => artIds.has(l.artworkId)),
    fixtures: layout.fixtures.filter(f => f.partId === partId),
    modules: layout.modules.filter(m => m.partId === partId),
  });
};

export type LayoutApply =
  /** 다음 이동 때 조용히 새 배치로(지금 관이 그대로이거나 관 밖에 있음) */
  | { readonly kind: 'ON_NEXT_MOVE'; readonly resumeStopId: string }
  /** "전시가 새로 바뀌었어요 `새로 보기`" 띠 */
  | { readonly kind: 'BANNER'; readonly resumeStopId: string };

/** 새 배치에서 이어서 볼 정지 지점: 같은 작품 → 같은 관의 소개 → 같은 이름(외관·홀·출구) → 첫 정지 지점 */
export const resumeStop = (next: Layout, current: Stop): string => {
  if (!current.partId) {
    const same = next.stops.find(s => s.id === current.id);
    if (same) return same.id;
  }
  if (current.artworkId) {
    const same = next.stops.find(s => s.artworkId === current.artworkId);
    if (same) return same.id;
  }
  if (current.partId) {
    const intro = next.stops.find(s => s.kind === 'roomIntro' && s.partId === current.partId);
    if (intro) return intro.id;
  }
  return next.stops[0]?.id ?? 'exterior';
};

/** 배치가 바뀌었을 때: 지금 있는 관의 모양이 그대로면 조용히, 아니면 띠. 외관·홀·출구에 있으면 조용히. */
export const decideLayoutApply = (prev: Layout, next: Layout, currentStopId: string): LayoutApply => {
  const current = prev.stops.find(s => s.id === currentStopId) ?? prev.stops[0];
  if (!current) return { kind: 'ON_NEXT_MOVE', resumeStopId: next.stops[0]?.id ?? 'exterior' };
  const resumeStopId = resumeStop(next, current);
  if (!current.partId) return { kind: 'ON_NEXT_MOVE', resumeStopId };
  const same = partSignature(prev, current.partId) === partSignature(next, current.partId);
  return { kind: same ? 'ON_NEXT_MOVE' : 'BANNER', resumeStopId };
};

/** 버전을 확인할 때인가: 화면이 보일 때만, 마지막 확인에서 `CHANGE_POLL_SEC`가 지났거나 방금 화면에 돌아왔으면 */
export const shouldPoll = (
  lastPollAt: number,
  now: number,
  visible: boolean,
  justReturned: boolean,
): boolean => visible && (justReturned || now - lastPollAt >= config().CHANGE_POLL_SEC * 1000);
