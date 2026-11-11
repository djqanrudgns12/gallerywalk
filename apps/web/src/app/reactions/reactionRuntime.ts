import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import type { ReactionView } from '@gallery/core/types';
import { useCallback, useSyncExternalStore } from 'react';
import type { VisitTarget } from '../../ports/index.ts';
import { type AppServices, useServices } from '../services.ts';
import {
  createReactionOutbox,
  defaultOutboxStorage,
  type OutboxItem,
  type OutboxStorage,
  type ReactionOutbox,
  startOutboxTriggers,
} from './outbox.ts';

/**
 * 반응 기기 쪽 한 벌(앱에 하나, `AppServices`마다): 보내기 줄 + 내 반응 기억 + 다시 보내기 계기.
 * 시트(`ReactionLayer`)는 열고 닫을 때마다 새로 생기지만, 줄과 기억은 여기 남는다 — 시트를 닫아도 줄은 연결이 돌아오면 보낸다.
 * `AppServices`에 칸이 생기면 그리로 옮긴다(지금은 `app/services.ts`를 고치지 않으려고 약한 지도에 둔다).
 */
export interface ReactionRuntime {
  readonly outbox: ReactionOutbox;
  /** 이 전시의 내 반응을 받아 둔다(전시마다 한 번 — 성공한 것만 기억, 끊기면 다음에 열 때 다시). 등록 전이면 받지 않는다 */
  loadMine(target: VisitTarget): Promise<void>;
  /** 기억한 내 반응(없으면 null) */
  mine(exhibitionId: string, artworkId: string): ReactionView | null;
  /** 이 기기가 그 전시에 등록을 마쳤는가(동의한 판이 있음) */
  registered(exhibitionId: string): boolean;
  dispose(): void;
}

export interface ReactionRuntimeOptions {
  /** 줄 저장소(기본: IndexedDB, 없으면 탭 메모리) */
  readonly storage?: OutboxStorage | undefined;
  /** false면 `online`·화면 복귀·주기 다시 보내기를 걸지 않는다(시험) */
  readonly triggers?: boolean | undefined;
}

export const createReactionRuntime = (
  services: Pick<AppServices, 'api' | 'device'>,
  opts: ReactionRuntimeOptions = {},
): ReactionRuntime => {
  const { student } = services.api;
  const { device } = services;
  const known = new Map<string, Map<string, ReactionView>>();
  const fetched = new Set<string>();
  const inflight = new Map<string, Promise<void>>();

  const remember = (exhibitionId: string, view: ReactionView): void => {
    let byArtwork = known.get(exhibitionId);
    if (!byArtwork) known.set(exhibitionId, (byArtwork = new Map()));
    const prev = byArtwork.get(view.artworkId);
    if (!prev || prev.updatedAt <= view.updatedAt) byArtwork.set(view.artworkId, view);
  };

  const registered = (exhibitionId: string): boolean => {
    const v = device.visitor(exhibitionId);
    return v !== null && v.consentVersion !== null;
  };

  /** 등록(아직이면) → PUT. 기기는 등록했다고 아는데 서버에 기록이 없으면(`E_AUTH`) 한 번 다시 등록하고 다시 보낸다 */
  const send = async (item: OutboxItem): Promise<ReactionView> => {
    const target: VisitTarget = { code: item.code, exhibitionId: item.exhibitionId };
    if (!registered(item.exhibitionId))
      await student.registerVisitor(target, item.register ?? { consentVersion: config().CONSENT_VERSION });
    try {
      return await student.putReaction(target, item.artworkId, item.body);
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'E_AUTH') throw err;
      const nickname = device.visitor(item.exhibitionId)?.nickname ?? item.register?.nickname ?? null;
      const consentVersion = config().CONSENT_VERSION;
      await student.registerVisitor(
        target,
        nickname === null ? { consentVersion } : { consentVersion, nickname },
      );
      return await student.putReaction(target, item.artworkId, item.body);
    }
  };

  const outbox = createReactionOutbox({ storage: opts.storage ?? defaultOutboxStorage(), send });
  const unsubscribe = outbox.subscribe(e => {
    if (e.type === 'sent') remember(e.item.exhibitionId, e.view);
  });
  const stopTriggers = opts.triggers === false ? () => undefined : startOutboxTriggers(outbox);
  // 앞서 연 탭이 남긴 줄은 시작할 때 한 번 보낸다
  void outbox.ready().then(() => {
    if (outbox.hasPending()) void outbox.flush();
  });

  return {
    outbox,
    registered,

    loadMine(target) {
      const id = target.exhibitionId;
      if (fetched.has(id) || !registered(id)) return Promise.resolve();
      let p = inflight.get(id);
      if (!p) {
        p = student
          .myReactions(target)
          .then(list => {
            for (const r of list) remember(id, r);
            fetched.add(id);
          })
          .catch(() => undefined)
          .finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
      return p;
    },

    mine: (exhibitionId, artworkId) => known.get(exhibitionId)?.get(artworkId) ?? null,

    dispose() {
      stopTriggers();
      unsubscribe();
    },
  };
};

const runtimes = new WeakMap<object, ReactionRuntime>();

/** 그 서비스 묶음의 반응 한 벌(처음 부를 때 만든다) */
export const reactionRuntime = (services: AppServices): ReactionRuntime => {
  let rt = runtimes.get(services);
  if (!rt) {
    rt = createReactionRuntime(services);
    runtimes.set(services, rt);
  }
  return rt;
};

/** 시험·개발 화면: 주입한 저장소로 바꿔 끼운다(앞의 것은 멈춘다) */
export const installReactionRuntime = (
  services: AppServices,
  opts: ReactionRuntimeOptions,
): ReactionRuntime => {
  runtimes.get(services)?.dispose();
  const rt = createReactionRuntime(services, opts);
  runtimes.set(services, rt);
  return rt;
};

export const useReactionRuntime = (): ReactionRuntime => reactionRuntime(useServices());

/**
 * 이 전시의 보내기 줄에 남은 것이 있는가(반응 단추의 작은 점, ADR-049). 관람 화면에 두면 줄의 다시 보내기 계기도 함께 살아 있다.
 */
export const useReactionPending = (exhibitionId: string): boolean => {
  const rt = useReactionRuntime();
  const subscribe = useCallback((onChange: () => void) => rt.outbox.subscribe(onChange), [rt]);
  return useSyncExternalStore(subscribe, () => rt.outbox.hasPending(exhibitionId));
};
