import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { LiveServerMessageSchema, type BubbleSettings, type Pose } from '@gallery/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE, createLiveHub, type LiveHub, type LiveSocket } from '../../src/live/hub.ts';
import type { LogFields, Logger } from '../../src/log.ts';
import { hello, newToken, pose, seedExhibition, seedTeacher } from './support.ts';
import { testDeps } from '../support/memoryStore.ts';

/**
 * 머리 위 말풍선 중계(PRD_V2 W-02, M4-2): 허브를 가짜 소켓으로 바로 돌린다(웹소켓 없음). 방송 타이머만 가짜, 시계는 시험 저장소의
 * 시계(`t.advance`). 글·번호·토큰은 모두 시험 안에서 만든 가상 값이고, 욕설은 가상 목록(`가짜욕`)으로만 본다.
 */

class FakeSocket implements LiveSocket {
  readonly texts: string[] = [];
  readonly shared: Buffer[] = [];
  closedWith: number | null = null;
  send(text: string): void {
    if (this.closedWith === null) this.texts.push(text);
  }
  sendShared(data: Buffer): boolean {
    if (this.closedWith === null) this.shared.push(data);
    return true;
  }
  close(code: number): void {
    this.closedWith = code;
  }
  /** 받은 글 메시지(종류별) — 모두 서버 약속(`LiveServerMessageSchema`)으로 검사한다 */
  messages(t: string): Record<string, unknown>[] {
    return this.texts
      .map(x => JSON.parse(x) as Record<string, unknown>)
      .filter(m => m['t'] === t)
      .map(m => {
        expect(LiveServerMessageSchema.safeParse(m).success).toBe(true);
        return m;
      });
  }
}

/** 허브가 기록에 넘긴 것을 모두 모은다(파일에 쓰기 전 — 거르기 전의 원본) */
const recordingLogger = (): Logger & { readonly lines: { msg: string; fields?: LogFields }[] } => {
  const lines: { msg: string; fields?: LogFields }[] = [];
  const push = (msg: string, fields?: LogFields): void =>
    void lines.push(fields === undefined ? { msg } : { msg, fields });
  return { lines, info: push, warn: push, error: push, fatal: push, close: () => undefined };
};

let t: ReturnType<typeof testDeps>;
let hub: LiveHub;
let log: ReturnType<typeof recordingLogger>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  t = testDeps();
  log = recordingLogger();
  // 시험 저장소의 난수는 짧게 되풀이돼 sid가 겹칠 수 있다 — 여기서는 진짜 난수
  hub = createLiveHub({ deps: { ...t.deps, random: { int: (lo, hi) => randomInt(lo, hi + 1) } }, log });
});

afterEach(() => {
  hub.shutdown();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetConfig();
});

/** 판 `v` 기기 하나가 들어온다(교사는 그 전시의 교사 세션을 새로 만들어 쓴다) */
const join = (code: string, v: 1 | 2, as: 'visitor' | 'teacher' = 'visitor', at: Pose = pose(1)) => {
  const socket = new FakeSocket();
  const conn = hub.open(socket, code);
  const exhibition = t.store.exhibitions.getByEntryCode(code);
  if (!exhibition) throw new Error('exhibition');
  const token = as === 'teacher' ? seedTeacher(t, exhibition.id) : newToken();
  conn.receive(JSON.stringify(hello(token, { as, pose: at, v })));
  const welcome = socket.messages('welcome')[0];
  expect(welcome).toBeDefined();
  const sid = String(welcome?.['you']);
  const say = (b: unknown): void => conn.receive(JSON.stringify({ t: 'bubble', b }));
  return { socket, conn, welcome, sid, say };
};

/** 교사 화면이 저장한 것처럼 저장소의 말풍선 설정을 바꾼다(허브에는 알리지 않음) */
const setBubbles = (exhibitionId: string, bubbles: BubbleSettings): void => {
  const ex = t.store.exhibitions.get(exhibitionId);
  if (!ex) throw new Error('exhibition');
  t.store.exhibitions.update(exhibitionId, { settings: { ...ex.settings, bubbles } });
};

const SEC = 1000;

/**
 * 서버는 `@gallery/core/live` → `bubble.ts` → 이 모듈의 `isBlocked`를 부른다. 묶음 입구(`@gallery/core/reactions`)를 가로채면
 * `bubble.ts`에 먹지 않아 그 모듈을 바로 연다. 다른 프로젝트 파일을 정적으로 가져오면 tsc가 막으므로(TS2878) 주소를 값으로 둔다.
 */
const PROFANITY_MODULE = fileURLToPath(
  new URL('../../../../packages/core/src/domain/reactions/profanity.ts', import.meta.url),
);
type Profanity = Pick<typeof import('@gallery/core/reactions'), 'isBlocked'>;

describe('말풍선 중계(W-02)', () => {
  it('스티커·정해진 말은 같은 전시 다른 판 2 기기에 send로(보낸 사람·판 1·다른 전시 제외), at은 서버가 받은 시각', () => {
    const ex = seedExhibition(t);
    const other = seedExhibition(t);
    const a = join(ex.entryCode, 2);
    const b = join(ex.entryCode, 2);
    const teacher = join(ex.entryCode, 2, 'teacher');
    const old = join(ex.entryCode, 1);
    const away = join(other.entryCode, 2);

    a.say({ k: 's', i: 3 });
    const sticker = { t: 'bubble', sid: a.sid, at: t.at(), b: { k: 's', i: 3 } };
    expect(b.socket.messages('bubble')).toEqual([sticker]);
    expect(teacher.socket.messages('bubble')).toEqual([sticker]);
    // 건너뛰어도 되는 위치 글 길(sendShared)로 보내지 않는다
    expect(b.socket.shared).toEqual([]);
    expect(a.socket.messages('bubble')).toEqual([]);
    expect(old.socket.texts.some(x => x.includes('"bubble"'))).toBe(false);
    expect(away.socket.messages('bubble')).toEqual([]);

    t.advance(SEC);
    a.say({ k: 'p', i: config().BUBBLE_PHRASES - 1 });
    expect(b.socket.messages('bubble').at(-1)).toEqual({
      t: 'bubble',
      sid: a.sid,
      at: t.at(),
      b: { k: 'p', i: config().BUBBLE_PHRASES - 1 },
    });
    // 선생님의 말풍선도 학생에게 간다
    teacher.say({ k: 'p', i: 0 });
    expect(a.socket.messages('bubble')).toEqual([
      { t: 'bubble', sid: teacher.sid, at: t.at(), b: { k: 'p', i: 0 } },
    ]);
    for (const p of [a, b, teacher, old, away]) expect(p.socket.closedWith).toBeNull();
  });

  it('설정이 꺼져 있으면 중계하지 않고(닫지 않음), 저장소 값을 바꾸면 다시 들어오지 않아도 다음 말풍선부터 바로 먹는다', () => {
    const ex = seedExhibition(t);
    setBubbles(ex.id, { enabled: false, text: false });
    const a = join(ex.entryCode, 2);
    const b = join(ex.entryCode, 2);
    a.say({ k: 's', i: 0 });
    expect(b.socket.messages('bubble')).toEqual([]);
    expect(a.socket.closedWith).toBeNull();
    expect(a.socket.messages('bye')).toEqual([]);

    // 꺼져서 버린 것은 속도 칸을 쓰지 않는다 — 켜자마자 같은 순간에 보내도 간다
    setBubbles(ex.id, { enabled: true, text: false });
    a.say({ k: 's', i: 1 });
    expect(b.socket.messages('bubble').map(m => m['b'])).toEqual([{ k: 's', i: 1 }]);

    setBubbles(ex.id, { enabled: false, text: false });
    t.advance(SEC);
    a.say({ k: 's', i: 2 });
    expect(b.socket.messages('bubble')).toHaveLength(1);
  });

  it('짧은 글: text가 꺼져 있으면 버리고, 켜면 서버가 다듬은 글(한 줄·앞뒤 공백 정리)이 간다, 빈 글은 버린다', () => {
    const ex = seedExhibition(t);
    const a = join(ex.entryCode, 2);
    const b = join(ex.entryCode, 2);
    // 기본: 켬 · 짧은 글 끔(U-31)
    expect(t.store.exhibitions.get(ex.id)?.settings.bubbles).toEqual({ enabled: true, text: false });
    a.say({ k: 'x', text: '같이 보자' });
    expect(b.socket.messages('bubble')).toEqual([]);
    expect(a.socket.closedWith).toBeNull();

    setBubbles(ex.id, { enabled: true, text: true });
    t.advance(SEC);
    a.say({ k: 'x', text: '  같이\n보자   요 ' });
    expect(b.socket.messages('bubble')).toEqual([
      { t: 'bubble', sid: a.sid, at: t.at(), b: { k: 'x', text: '같이 보자 요' } },
    ]);

    // 형식(1자 이상)은 맞지만 다듬으면 빈 글 — 글 거름 길을 타서 조용히 버린다
    t.advance(SEC);
    a.say({ k: 'x', text: ' \n\t ' });
    expect(b.socket.messages('bubble')).toHaveLength(1);
    expect(a.socket.closedWith).toBeNull();
  });

  it('욕설은 별명·메모와 같은 isBlocked로 걸러 버린다(가상 목록으로 실제 정규화 경로 검사)', async () => {
    const profanity = (await import(PROFANITY_MODULE)) as Profanity;
    const actual = profanity.isBlocked;
    const blocked = vi.spyOn(profanity, 'isBlocked').mockImplementation(text => actual(text, ['가짜욕']));
    const ex = seedExhibition(t);
    setBubbles(ex.id, { enabled: true, text: true });
    const a = join(ex.entryCode, 2);
    const b = join(ex.entryCode, 2);
    a.say({ k: 'x', text: ' 가.짜1욕 ' });
    // 가로챈 함수를 서버 길이 실제로 불렀다(가로채기가 먹었다)
    expect(blocked).toHaveBeenCalledWith('가.짜1욕');
    expect(b.socket.messages('bubble')).toEqual([]);
    expect(a.socket.closedWith).toBeNull();
    t.advance(SEC);
    a.say({ k: 'x', text: '같이 보자' });
    expect(b.socket.messages('bubble').map(m => m['b'])).toEqual([{ k: 'x', text: '같이 보자' }]);
  });

  it('속도 제한: 한 사람은 1초에 1개·10초에 5개까지, 넘는 것은 조용히 버리고 시계가 지나면 다시 간다(사람마다 따로)', () => {
    overrideConfig({ BUBBLE_RATE: { perSec: 1, per10Sec: 5 } });
    const ex = seedExhibition(t);
    const a = join(ex.entryCode, 2);
    const b = join(ex.entryCode, 2);
    const got = (): number => b.socket.messages('bubble').length;
    const start = t.at();
    const at = (ms: number): void => t.advance(start + ms - t.at());

    a.say({ k: 's', i: 0 });
    expect(got()).toBe(1);
    at(SEC - 1);
    a.say({ k: 's', i: 1 });
    expect(got()).toBe(1);
    // 1초가 지나면 다음 하나
    for (const s of [1, 2, 3, 4]) {
      at(s * SEC);
      a.say({ k: 's', i: s });
      expect(got()).toBe(s + 1);
    }
    // 10초 안 여섯 번째는 버림
    at(5 * SEC);
    a.say({ k: 's', i: 5 });
    at(10 * SEC - 1);
    a.say({ k: 's', i: 6 });
    expect(got()).toBe(5);
    expect(a.socket.closedWith).toBeNull();
    expect(a.socket.messages('bye')).toEqual([]);
    // 첫 말풍선이 10초 창을 벗어나면 다시 간다
    at(10 * SEC);
    a.say({ k: 's', i: 7 });
    expect(got()).toBe(6);
    expect(b.socket.messages('bubble').at(-1)?.['b']).toEqual({ k: 's', i: 7 });
    // 다른 사람의 상한은 따로
    b.say({ k: 's', i: 0 });
    expect(a.socket.messages('bubble')).toHaveLength(1);
  });

  it('판 1 연결이 bubble을 보내면 E_VALIDATION으로 닫고, 들어오기 전·약속에 없는 모양도 닫는다', () => {
    const ex = seedExhibition(t);
    const b = join(ex.entryCode, 2);
    const old = join(ex.entryCode, 1);
    old.say({ k: 's', i: 0 });
    expect(old.socket.messages('bye')).toEqual([{ t: 'bye', code: 'E_VALIDATION' }]);
    expect(old.socket.closedWith).toBe(CLOSE.policy);
    expect(b.socket.messages('bubble')).toEqual([]);

    const early = new FakeSocket();
    hub.open(early, ex.entryCode).receive(JSON.stringify({ t: 'bubble', b: { k: 's', i: 0 } }));
    expect(early.closedWith).toBe(CLOSE.policy);

    // 조용히 버리는 것(설정·속도·글 거름)과 달리 약속 밖 모양은 닫는다: 없는 번호 · 넘친 글 · 덧붙인 칸
    for (const bad of [
      { t: 'bubble', b: { k: 's', i: config().BUBBLE_STICKERS } },
      { t: 'bubble', b: { k: 'x', text: '가'.repeat(config().BUBBLE_TEXT_MAX + 1) } },
      { t: 'bubble', b: { k: 'p', i: 0 }, at: 1 },
    ]) {
      const c = join(ex.entryCode, 2);
      c.conn.receive(JSON.stringify(bad));
      expect(c.socket.messages('bye')).toEqual([{ t: 'bye', code: 'E_VALIDATION' }]);
      expect(c.socket.closedWith).toBe(CLOSE.policy);
    }
    expect(b.socket.messages('bubble')).toEqual([]);
    expect(b.socket.closedWith).toBeNull();
  });

  it('welcome에는 판 2 기기에만 그 전시의 지금 설정, settingsChanged는 그 방의 판 2 기기 모두에게 cfg', () => {
    const ex = seedExhibition(t);
    const other = seedExhibition(t);
    setBubbles(ex.id, { enabled: true, text: true });
    const a = join(ex.entryCode, 2);
    const teacher = join(ex.entryCode, 2, 'teacher');
    const old = join(ex.entryCode, 1);
    const away = join(other.entryCode, 2);
    expect(a.welcome?.['bubbles']).toEqual({ enabled: true, text: true });
    expect(teacher.welcome?.['bubbles']).toEqual({ enabled: true, text: true });
    expect(away.welcome?.['bubbles']).toEqual({ enabled: true, text: false });
    // 판 1 앱의 strict 스키마가 깨지지 않게 칸을 붙이지 않는다
    expect(old.welcome && 'bubbles' in old.welcome).toBe(false);

    setBubbles(ex.id, { enabled: false, text: false });
    hub.settingsChanged(ex.id);
    const cfg = { t: 'cfg', bubbles: { enabled: false, text: false } };
    expect(a.socket.messages('cfg')).toEqual([cfg]);
    expect(teacher.socket.messages('cfg')).toEqual([cfg]);
    expect(old.socket.texts.some(x => x.includes('"cfg"'))).toBe(false);
    expect(away.socket.messages('cfg')).toEqual([]);
    // 방이 없거나 없는 전시면 아무 일도 하지 않는다
    const empty = seedExhibition(t);
    expect(() => hub.settingsChanged(empty.id)).not.toThrow();
    expect(() => hub.settingsChanged('00000000-0000-4000-8000-000000000000')).not.toThrow();
    expect(a.socket.messages('cfg')).toHaveLength(1);
    // 늦게 들어온 사람은 welcome에서 바뀐 값을 받는다
    expect(join(ex.entryCode, 2).welcome?.['bubbles']).toEqual({ enabled: false, text: false });
    for (const p of [a, teacher, old, away]) expect(p.socket.closedWith).toBeNull();
  });

  it('기록에는 말풍선 내용(번호·글)이 남지 않는다', () => {
    const ex = seedExhibition(t);
    setBubbles(ex.id, { enabled: true, text: true });
    const a = join(ex.entryCode, 2);
    const b = join(ex.entryCode, 2);
    const old = join(ex.entryCode, 1);
    const words = '하늘색 고래 그림';
    a.say({ k: 's', i: 7 });
    t.advance(SEC);
    a.say({ k: 'p', i: 9 });
    t.advance(SEC);
    a.say({ k: 'x', text: words });
    // 버리는 길(속도 제한·판 1 거절)도 지나게
    a.say({ k: 'x', text: words });
    old.say({ k: 'x', text: words });
    expect(b.socket.messages('bubble')).toHaveLength(3);
    hub.flushStats({});
    const text = JSON.stringify(log.lines);
    // 기록이 실제로 남았는데(연결·거절 수) 그 안에 내용이 없다
    expect(log.lines.map(l => l.msg)).toEqual(
      expect.arrayContaining(['server_stats', 'live_connections', 'live_reject']),
    );
    expect(text).not.toContain(words);
    expect(text).not.toMatch(/bubble|"k"|"i"|"text"/);
  });
});
