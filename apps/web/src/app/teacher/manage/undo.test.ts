import { config } from '@gallery/core/config';
import { copy, errorCopy, eulReul, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { afterEach, describe, expect, it } from 'vitest';
import { testArtworkId, testRoomId } from '../../../dev/testView.ts';
import { fakeTeacherServer, teacherView, T_ROOM_TITLES } from '../../../dev/teacherFixtures.ts';
import type { TeacherApi } from '../../../ports/index.ts';
import { useTeacherStore } from './teacherStore.ts';
import { createUndoStack, isUndoKey, movedItem } from './undo.ts';
import { createManageActions } from './useManage.ts';

const A = (r: number, i: number) => testArtworkId(r, i);
const R0 = testRoomId(0);
const R1 = testRoomId(1);

afterEach(() => useTeacherStore.getState().reset());

const setup = async (over: Partial<TeacherApi> = {}) => {
  const srv = fakeTeacherServer(teacherView([3, 1]), over);
  const actions = createManageActions(srv.api, 'ex');
  await actions.reload();
  return { srv, actions };
};

/** 서버 쪽 전시실 순서(지운 것 빼고) */
const serverRoom = (srv: ReturnType<typeof fakeTeacherServer>, roomId: string) =>
  srv.state.artworks
    .filter(a => a.roomId === roomId && a.deletedAt === null)
    .sort((a, b) => a.order - b.order)
    .map(a => a.id);

const toastText = () => useTeacherStore.getState().toast?.text;
const status = (srv: ReturnType<typeof fakeTeacherServer>, id: string) =>
  srv.state.artworks.find(a => a.id === id)?.status;

describe('되돌리기 스택(HT-08)', () => {
  it('최근 것부터 꺼내고, 상한을 넘으면 가장 오래된 것을 버리고, 이미 되돌린 것은 뺄 수 있다', async () => {
    const s = createUndoStack(2);
    const e = (text: string) => ({ text, undo: async () => undefined });
    const a = e('a');
    const b = e('b');
    const c = e('c');
    s.push(a);
    s.push(b);
    s.push(c);
    expect(s.size).toBe(2);
    s.remove(b);
    expect(s.pop()).toBe(c);
    expect(s.pop()).toBeUndefined();
  });

  it('가장 많이 움직인 작품과 새 자리를 찾고, 그대로면 null', () => {
    expect(movedItem(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual({ id: 'a', index: 2 });
    expect(movedItem(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ id: 'c', index: 0 });
    expect(movedItem(['a', 'b'], ['a', 'b'])).toBeNull();
  });

  it('Ctrl+Z·⌘Z만, Shift·Alt가 붙거나 글 칸 안이면 아님', () => {
    const k = (over: Partial<Parameters<typeof isUndoKey>[0]>) =>
      isUndoKey({
        key: 'z',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
        ...over,
      });
    expect(k({ ctrlKey: true })).toBe(true);
    expect(k({ metaKey: true, key: 'Z' })).toBe(true);
    expect(k({})).toBe(false);
    expect(k({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(k({ metaKey: true, altKey: true })).toBe(false);
    expect(k({ ctrlKey: true, target: { tagName: 'input' } })).toBe(false);
    expect(k({ ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
    expect(k({ ctrlKey: true, target: { tagName: 'BUTTON' } })).toBe(true);
  });

  it('을/를은 받침에 맞춘다', () => {
    expect(eulReul('바다')).toBe('를');
    expect(eulReul('하늘')).toBe('을');
    expect(eulReul('Sky')).toBe('을(를)');
    expect(eulReul('')).toBe('을(를)');
  });
});

describe('편집 되돌리기(HT-08) — 반대 요청', () => {
  it('순서: 토스트에 무엇을 몇 번째로 옮겼는지 + 되돌리기, 되돌리면 서버 순서가 처음대로', async () => {
    const { srv, actions } = await setup();
    const before = serverRoom(srv, R0);
    await actions.nudgeArtwork(A(0, 0), 1);
    expect(serverRoom(srv, R0)).toEqual([A(0, 1), A(0, 0), A(0, 2)]);
    const title = srv.state.artworks.find(a => a.id === A(0, 0))!.title;
    expect(toastText()).toBe(fill(copy.teacher.undo.moved, { title, eul: eulReul(title), n: 2 }));
    expect(useTeacherStore.getState().toast?.action?.label).toBe(copy.teacher.undo.action);

    useTeacherStore.getState().toast?.action?.run();
    await new Promise(r => setTimeout(r, 0));
    await actions.reload();
    expect(serverRoom(srv, R0)).toEqual(before);
    expect(toastText()).toBe(copy.teacher.undo.undone);
  });

  it('전시실 바꾸기(끌어 옮기기 한 장): 되돌리면 원래 전시실·원래 순서로', async () => {
    const { srv, actions } = await setup();
    await actions.moveArtworks([A(0, 1)], R1);
    expect(serverRoom(srv, R1)).toContain(A(0, 1));
    expect(toastText()).toContain(T_ROOM_TITLES[1]);
    await actions.undo();
    expect(serverRoom(srv, R0)).toEqual([A(0, 0), A(0, 1), A(0, 2)]);
    expect(serverRoom(srv, R1)).toEqual([A(1, 0)]);
  });

  it('여러 장 옮기기: 되돌리면 각자 원래 전시실·순서로', async () => {
    const { srv, actions } = await setup();
    await actions.batch({ action: 'MOVE', ids: [A(0, 0), A(0, 2)], roomId: R1 });
    expect(serverRoom(srv, R0)).toEqual([A(0, 1)]);
    expect(toastText()).toContain('2');
    await actions.undo();
    expect(serverRoom(srv, R0)).toEqual([A(0, 0), A(0, 1), A(0, 2)]);
    expect(serverRoom(srv, R1)).toEqual([A(1, 0)]);
  });

  it('숨기기(한 장·여러 장): 되돌리면 원래 상태로, 이미 숨긴 것은 그대로', async () => {
    const { srv, actions } = await setup();
    const was = status(srv, A(0, 0));
    await actions.patchArtwork(A(0, 0), { status: 'HIDDEN' });
    expect(status(srv, A(0, 0))).toBe('HIDDEN');
    await actions.undo();
    expect(status(srv, A(0, 0))).toBe(was);

    await actions.patchArtwork(A(0, 1), { status: 'HIDDEN' });
    await actions.batch({ action: 'HIDE', ids: [A(0, 1), A(0, 2)] });
    expect(toastText()).toBe(fill(copy.teacher.undo.hiddenMany, { n: 1 }));
    await actions.undo();
    expect(status(srv, A(0, 1))).toBe('HIDDEN');
    expect(status(srv, A(0, 2))).toBe(was);
  });

  it('삭제: Ctrl/⌘+Z로 되살리고, 토스트 되살리기를 눌렀으면 스택에서 빠진다', async () => {
    const { srv, actions } = await setup();
    await actions.deleteArtwork(A(0, 2));
    expect(useTeacherStore.getState().toast?.ms).toBe(config().UNDO_DELETE_SEC * 1000);
    await actions.undo();
    expect(srv.state.artworks.find(a => a.id === A(0, 2))?.deletedAt).toBeNull();

    await actions.deleteArtwork(A(0, 1));
    useTeacherStore.getState().toast?.action?.run();
    await new Promise(r => setTimeout(r, 0));
    expect(srv.state.artworks.find(a => a.id === A(0, 1))?.deletedAt).toBeNull();
    await actions.undo();
    expect(toastText()).toBe(copy.teacher.undo.nothing);
  });

  it('되돌리는 중에는 반대 요청을 다시 쌓지 않는다(되돌리기 두 번이면 두 단계 전으로)', async () => {
    const { srv, actions } = await setup();
    await actions.nudgeArtwork(A(0, 0), 1);
    await actions.patchArtwork(A(0, 2), { status: 'HIDDEN' });
    await actions.undo();
    await actions.undo();
    expect(serverRoom(srv, R0)).toEqual([A(0, 0), A(0, 1), A(0, 2)]);
    expect(status(srv, A(0, 2))).not.toBe('HIDDEN');
    await actions.undo();
    expect(toastText()).toBe(copy.teacher.undo.nothing);
  });

  it('글 칸 고치기는 쌓지 않는다', async () => {
    const { actions } = await setup();
    await actions.patchArtwork(A(0, 0), { title: '새 이름' });
    await actions.undo();
    expect(toastText()).toBe(copy.teacher.undo.nothing);
  });

  it('그사이 다른 곳에서 바뀌었으면(rev 충돌) 새로 불러오기 안내 + 스택을 비운다', async () => {
    const { srv, actions } = await setup();
    await actions.patchArtwork(A(0, 0), { status: 'HIDDEN' });
    await actions.patchArtwork(A(0, 1), { status: 'HIDDEN' });
    // 다른 기기가 같은 작품을 고침 → 이 화면의 rev가 낡음
    const a = srv.state.artworks.find(x => x.id === A(0, 1))!;
    a.rev += 1;
    await actions.undo();
    expect(toastText()).toBe(errorCopy.E_CONFLICT);
    await new Promise(r => setTimeout(r, 0));
    await actions.undo();
    expect(toastText()).toBe(copy.teacher.undo.nothing);
  });

  it('반대 요청이 실패하면(화면 먼저 바꾼 순서) 알리고 서버 상태로 새로 불러온다', async () => {
    let fails = false;
    let impl: Partial<TeacherApi> = {};
    const { srv, actions } = await setup({
      putArrangement: async (...args) => {
        if (fails) throw new AppError('E_SERVER');
        return impl.putArrangement!(...args);
      },
    });
    impl = srv.impl;
    await actions.nudgeArtwork(A(0, 0), 1);
    fails = true;
    await actions.undo();
    expect(toastText()).toBe(errorCopy.E_SERVER);
    expect(srv.named('exhibition').length).toBeGreaterThanOrEqual(3);
  });
});
