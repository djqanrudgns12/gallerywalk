import type { ExhibitionView } from '@gallery/core/types';
import { useEffect, useState } from 'react';
import type { MediaCache, PreloadProgress } from '../../ports/mediaCache.ts';
import type { VisitProgress } from '../visit/contract.ts';

/**
 * 포스터 동안 미리 불러오기(P4-8, PLAN §2.5): 서비스 워커에 첫 전시실(템플릿·썸네일·벽용 2장)을 받게 한다.
 * 입장 단추는 3D 첫 자리 준비와 미리 불러오기가 둘 다 끝나야 풀린다. 서비스 워커가 없거나(개발·미지원) 공간이
 * 모자라거나 실패하면 미리 불러오기는 "끝남"으로 친다 — 관람은 네트워크로 그대로 된다(막지 않음).
 */
export interface PreloadState {
  readonly done: boolean;
  /** 0~1 */
  readonly fraction: number;
}

const DONE: PreloadState = { done: true, fraction: 1 };

export const usePosterPreload = (
  view: ExhibitionView | null,
  media: MediaCache | undefined,
): PreloadState => {
  const [state, setState] = useState<PreloadState>({ done: false, fraction: 0 });
  const id = view?.exhibition.id ?? null;
  useEffect(() => {
    if (!view) return;
    if (!media) {
      setState(DONE);
      return;
    }
    let alive = true;
    setState({ done: false, fraction: 0 });
    const onProgress = (p: PreloadProgress): void => {
      if (alive && p.kind === 'LOADING' && p.total > 0)
        setState({ done: false, fraction: p.completed / p.total });
    };
    void media
      .preload(view, onProgress)
      .catch(() => null)
      .then(() => {
        if (alive) setState(DONE);
      });
    return () => {
      alive = false;
    };
    // 같은 전시면 다시 받지 않는다(내용만 바뀐 새 보기 묶음으로는 다시 시작하지 않음 — `view`는 `id`로 대신)
  }, [id, media]);
  return view ? state : DONE;
};

/** 3D 첫 자리 준비와 미리 불러오기를 하나의 진행으로(미리 불러오기가 끝났거나 없으면 3D 준비 진행 그대로) */
export const combineProgress = (scene: VisitProgress, pre: PreloadState): VisitProgress => ({
  ready: scene.ready && pre.done,
  progress: pre.done ? scene.progress : (scene.progress + pre.fraction) / 2,
});
