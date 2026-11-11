import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import type { ReactionView } from '@gallery/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../dev/studentFixtures.ts';
import { TEST_EXHIBITION_ID, testArtworkId } from '../../dev/testView.ts';
import {
  createReactionOutbox,
  memoryOutboxStorage,
  type OutboxItem,
  type OutboxStorage,
  reactionKey,
  startOutboxTriggers,
} from './outbox.ts';

const ART = testArtworkId(0, 0);
const ART2 = testArtworkId(0, 1);

const item = (over: Partial<OutboxItem> = {}): OutboxItem => {
  const artworkId = over.artworkId ?? ART;
  return {
    key: reactionKey(TEST_EXHIBITION_ID, artworkId),
    exhibitionId: TEST_EXHIBITION_ID,
    code: '123456',
    artworkId,
    body: { sticker: 'MOVED', memo: null, scoreFact: null, scoreDelivery: null },
    register: null,
    queuedAt: 1,
    ...over,
  };
};

const viewOf = (i: OutboxItem): ReactionView => ({
  artworkId: i.artworkId,
  sticker: i.body.sticker,
  memo: i.body.memo,
  scoreFact: i.body.scoreFact,
  scoreDelivery: i.body.scoreDelivery,
  updatedAt: 1,
});

/** 끊김을 켜고 끄는 가짜 보내기 */
const fakeSend = () => {
  const state = { online: true, fail: [] as AppError[] };
  const send = vi.fn(async (i: OutboxItem) => {
    const f = state.fail.shift();
    if (f) throw f;
    if (!state.online) throw new AppError('E_OFFLINE');
    return viewOf(i);
  });
  return { state, send };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('반응 보내기 줄(ADR-049)', () => {
  it('반응 열쇠는 전시 ID + 작품 ID — 같은 작품을 다시 넣으면 한 칸만 남는다(멱등)', async () => {
    const storage = memoryOutboxStorage();
    const { state, send } = fakeSend();
    state.online = false;
    const outbox = createReactionOutbox({ storage, send });
    await outbox.ready();

    const first = await outbox.submit(item({ queuedAt: 1 }));
    const second = await outbox.submit(item({ queuedAt: 2, body: { ...item().body, sticker: 'GREAT' } }));
    expect(first).toMatchObject({ ok: false, code: 'E_OFFLINE', queued: true });
    expect(second).toMatchObject({ ok: false, queued: true });
    expect(storage.rows.size).toBe(1);
    expect(outbox.get(reactionKey(TEST_EXHIBITION_ID, ART))?.body.sticker).toBe('GREAT');

    state.online = true;
    await outbox.flush();
    // 줄에 하나 → 다시 보내기도 한 번(앞의 두 번은 끊겨서 실패)
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0].body.sticker).toBe('GREAT');
    expect(outbox.hasPending()).toBe(false);
    expect(storage.rows.size).toBe(0);
  });

  it('끊김·E_SERVER·E_RATE_LIMITED만 줄에 넣고, 다시 보내도 안 되는 실패는 넣지 않는다', async () => {
    const { state, send } = fakeSend();
    const outbox = createReactionOutbox({ storage: memoryOutboxStorage(), send });
    for (const code of ['E_SERVER', 'E_RATE_LIMITED'] as const) {
      state.fail.push(new AppError(code));
      const r = await outbox.submit(item({ artworkId: code === 'E_SERVER' ? ART : ART2 }));
      expect(r).toMatchObject({ ok: false, code, queued: true });
    }
    expect(outbox.hasPending(TEST_EXHIBITION_ID)).toBe(true);

    const blocked = createReactionOutbox({ storage: memoryOutboxStorage(), send });
    state.fail.push(new AppError('E_MEMO_BLOCKED'));
    const r = await blocked.submit(item());
    expect(r).toMatchObject({ ok: false, code: 'E_MEMO_BLOCKED', queued: false });
    expect(blocked.hasPending()).toBe(false);
  });

  it('online 소식에 다시 보내고, 성공하면 줄에서 빠지며 sent 소식을 낸다', async () => {
    const storage = memoryOutboxStorage();
    const { state, send } = fakeSend();
    state.online = false;
    const outbox = createReactionOutbox({ storage, send });
    await outbox.submit(item());
    expect(outbox.hasPending(TEST_EXHIBITION_ID)).toBe(true);
    expect(outbox.hasPending('00000000-0000-4000-8000-0000000000ff')).toBe(false);

    const events: string[] = [];
    outbox.subscribe(e => events.push(e.type));
    const stop = startOutboxTriggers(outbox);
    state.online = true;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(outbox.hasPending()).toBe(false));
    expect(events).toContain('sent');
    expect(storage.rows.size).toBe(0);
    stop();
  });

  it('화면 복귀와 CHANGE_POLL_SEC 주기에도 다시 보낸다', async () => {
    vi.useFakeTimers();
    const { state, send } = fakeSend();
    state.online = false;
    const outbox = createReactionOutbox({ storage: memoryOutboxStorage(), send });
    await outbox.submit(item());
    const stop = startOutboxTriggers(outbox);

    // 화면 복귀: 아직 끊겨 있으면 줄에 그대로
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outbox.hasPending()).toBe(true);

    // 주기 확인: 연결이 돌아왔으면 보내고 빠진다
    state.online = true;
    await vi.advanceTimersByTimeAsync(config().CHANGE_POLL_SEC * 1000 - 1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(outbox.hasPending()).toBe(false);

    // 줄이 비면 주기마다 보내지 않는다
    await vi.advanceTimersByTimeAsync(config().CHANGE_POLL_SEC * 1000);
    expect(send).toHaveBeenCalledTimes(3);
    stop();
  });

  it('줄 보내기와 시트 보내기가 겹쳐도 차례로 보내 옛 판이 새 판 뒤에 도착하지 않는다', async () => {
    const gate = deferred<void>();
    const sent: string[] = [];
    let first = true;
    const send = vi.fn(async (i: OutboxItem) => {
      if (first) {
        first = false;
        throw new AppError('E_OFFLINE');
      }
      if (i.body.sticker === 'MOVED') await gate.promise;
      sent.push(i.body.sticker ?? '');
      return viewOf(i);
    });
    const outbox = createReactionOutbox({ storage: memoryOutboxStorage(), send });
    await outbox.submit(item({ queuedAt: 1 })); // 끊겨서 줄에(MOVED)
    const flushing = outbox.flush(); // MOVED를 보내는 중(문 앞에서 기다림)
    const newer = outbox.submit(item({ queuedAt: 2, body: { ...item().body, sticker: 'CURIOUS' } }));
    gate.resolve();
    await flushing;
    await expect(newer).resolves.toMatchObject({ ok: true });
    // 옛 판이 먼저, 새 판이 나중 — 서버에는 새 판이 남는다
    expect(sent).toEqual(['MOVED', 'CURIOUS']);
    expect(outbox.hasPending()).toBe(false);
  });

  it('다시 보내기에서 다시 보내도 안 되는 실패면 줄에서 빼고 dropped 소식을 낸다', async () => {
    const { state, send } = fakeSend();
    state.online = false;
    const outbox = createReactionOutbox({ storage: memoryOutboxStorage(), send });
    await outbox.submit(item());
    const dropped: string[] = [];
    outbox.subscribe(e => {
      if (e.type === 'dropped') dropped.push(e.code);
    });
    state.online = true;
    state.fail.push(new AppError('E_REACTIONS_OFF'));
    await outbox.flush();
    expect(dropped).toEqual(['E_REACTIONS_OFF']);
    expect(outbox.hasPending()).toBe(false);
  });

  it('저장소가 막혀도(IndexedDB 거절) 던지지 않고 탭 메모리 줄로 이어 간다', async () => {
    const broken: OutboxStorage = {
      all: () => Promise.reject(new Error('blocked')),
      put: () => Promise.reject(new Error('blocked')),
      remove: () => Promise.reject(new Error('blocked')),
    };
    const { state, send } = fakeSend();
    state.online = false;
    const outbox = createReactionOutbox({ storage: broken, send });
    await expect(outbox.submit(item())).resolves.toMatchObject({ queued: true });
    expect(outbox.hasPending()).toBe(true);
    state.online = true;
    await outbox.flush();
    expect(outbox.hasPending()).toBe(false);
  });

  it('저장소에 남은 줄을 읽어 다시 보낸다 — 모양이 틀린 줄은 지운다(바깥 입력 검사)', async () => {
    const storage = memoryOutboxStorage();
    const good = item({ queuedAt: 5 });
    storage.rows.set(good.key, good);
    storage.rows.set('bad', { key: 'bad', exhibitionId: 'nope' } as unknown as OutboxItem);
    const { send } = fakeSend();
    const outbox = createReactionOutbox({ storage, send });
    await outbox.ready();
    expect(outbox.hasPending()).toBe(true);
    expect(storage.rows.has('bad')).toBe(false);
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(storage.rows.size).toBe(0);
  });

  it('줄은 REACTION_OUTBOX_MAX를 넘으면 가장 오래된 것부터 뺀다', async () => {
    const { state, send } = fakeSend();
    state.online = false;
    const storage = memoryOutboxStorage();
    const outbox = createReactionOutbox({ storage, send });
    const max = config().REACTION_OUTBOX_MAX;
    for (let n = 0; n <= max; n++) {
      const artworkId = `00000000-0000-4000-8000-${(0x50000 + n).toString(16).padStart(12, '0')}`;
      await outbox.submit(item({ artworkId, queuedAt: n }));
    }
    expect(storage.rows.size).toBe(max);
    const oldest = `00000000-0000-4000-8000-${(0x50000).toString(16).padStart(12, '0')}`;
    expect(outbox.get(reactionKey(TEST_EXHIBITION_ID, oldest))).toBeNull();
  });
});
