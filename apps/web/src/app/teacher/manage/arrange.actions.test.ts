import { copy, errorCopy } from '@gallery/core/copy';
import { afterEach, describe, expect, it } from 'vitest';
import { testArtworkId, testRoomId } from '../../../dev/testView.ts';
import { fakeTeacherServer, teacherArtwork, teacherRoom, teacherView } from '../../../dev/teacherFixtures.ts';
import type { TeacherApi } from '../../../ports/index.ts';
import { columnsOf, diffArrangement, placeCards } from './arrange.ts';
import { useTeacherStore } from './teacherStore.ts';
import { createManageActions } from './useManage.ts';

const A = (r: number, i: number) => testArtworkId(r, i);
const R0 = testRoomId(0);
const R1 = testRoomId(1);

afterEach(() => useTeacherStore.getState().reset());

const setup = async (view = teacherView([3, 2]), over: Partial<TeacherApi> = {}) => {
  const srv = fakeTeacherServer(view, over);
  const actions = createManageActions(srv.api, 'ex');
  await actions.reload();
  return { srv, actions };
};

const board = () => columnsOf(useTeacherStore.getState().view);
const serverBoard = (srv: ReturnType<typeof fakeTeacherServer>) => columnsOf(srv.state);
const local = (id: string) => useTeacherStore.getState().view?.artworks.find(a => a.id === id);

describe('한 번에 놓기 동작(ADR-074, HT-03c)', () => {
  it('다른 판 n번째: 요청 하나, 화면·서버 같음, 되돌리기 토스트 문장에 전시실과 자리', async () => {
    const { srv, actions } = await setup();
    const a = diffArrangement(board(), placeCards(board(), [A(0, 2)], { roomId: R1, index: 1 }))!;
    expect(await actions.arrange(a, { moved: [A(0, 2)] })).toBe(true);
    expect(srv.named('putArrangement')).toHaveLength(1);
    expect(board()).toEqual(serverBoard(srv));
    expect(board().find(c => c.roomId === R1)?.ids).toEqual([A(1, 0), A(0, 2), A(1, 1)]);
    const toast = useTeacherStore.getState().toast;
    expect(toast?.text).toContain('2번째');
    expect(toast?.action?.label).toBe(copy.teacher.undo.action);
  });

  it('응답의 rev를 바로 반영: 놓은 직후 제목을 고쳐도 스스로 충돌하지 않는다', async () => {
    const { srv, actions } = await setup();
    const a = diffArrangement(board(), placeCards(board(), [A(0, 0)], { roomId: R1, index: 0 }))!;
    await actions.arrange(a);
    expect(local(A(0, 0))?.rev).toBe(srv.state.artworks.find(x => x.id === A(0, 0))?.rev);
    await actions.patchArtwork(A(0, 0), { title: '놓은 뒤 고친 제목' });
    expect(srv.state.artworks.find(x => x.id === A(0, 0))?.title).toBe('놓은 뒤 고친 제목');
    expect(useTeacherStore.getState().toast?.text).not.toBe(errorCopy.E_CONFLICT);
  });

  it('다른 기기가 먼저 바꿨으면(base 다름) 충돌: 알리고 서버 상태로 돌아온다', async () => {
    const { srv, actions } = await setup();
    // 다른 기기: 첫 판의 앞 두 작품 순서를 바꿈
    const [x, y] = srv.state.artworks.filter(a => a.roomId === R0);
    x!.order = 1;
    y!.order = 0;
    const a = diffArrangement(board(), placeCards(board(), [A(0, 2)], { roomId: R0, index: 0 }))!;
    expect(await actions.arrange(a)).toBe(false);
    expect(useTeacherStore.getState().toast?.text).toBe(errorCopy.E_CONFLICT);
    expect(board()).toEqual(serverBoard(srv));
  });

  it('놓기 사이에 올라온 새 작품은 충돌이 아니고 그 판 끝에 붙는다', async () => {
    const { srv, actions } = await setup();
    const before = board();
    srv.state.artworks.push(teacherArtwork(0, 9, { order: 9 }));
    const a = diffArrangement(before, placeCards(before, [A(0, 0)], { roomId: R0, index: 2 }))!;
    expect(await actions.arrange(a)).toBe(true);
    expect(
      srv.state.artworks
        .filter(x => x.roomId === R0)
        .sort((p, q) => p.order - q.order)
        .map(x => x.id),
    ).toEqual([A(0, 1), A(0, 2), A(0, 0), A(0, 9)]);
  });

  it('대표작을 다른 판으로 옮기면 풀리고, 되돌리면 되살아난다', async () => {
    const view = teacherView([2, 1]);
    view.artworks = view.artworks.map(x => (x.id === A(0, 0) ? { ...x, featured: true } : x));
    const { srv, actions } = await setup(view);
    await actions.moveArtworks([A(0, 0)], R1);
    expect(srv.state.artworks.find(x => x.id === A(0, 0))?.featured).toBe(false);
    expect(local(A(0, 0))?.featured).toBe(false);
    await actions.undo();
    expect(srv.state.artworks.find(x => x.id === A(0, 0))).toMatchObject({ roomId: R0, featured: true });
    expect(srv.named('putArrangement')[1]?.args[1]).toMatchObject({ restoreFeatured: [A(0, 0)] });
    expect(useTeacherStore.getState().toast?.text).toBe(copy.teacher.undo.undone);
  });

  it('여러 개 옮기기: 보드 차례대로 옮긴 곳 끝에, 되돌리면 원래 자리', async () => {
    const { srv, actions } = await setup();
    const start = board();
    await actions.moveArtworks([A(0, 2), A(0, 0)], R1);
    expect(board().find(c => c.roomId === R1)?.ids).toEqual([A(1, 0), A(1, 1), A(0, 0), A(0, 2)]);
    await actions.undo();
    expect(serverBoard(srv)).toEqual(start);
  });

  it('연달아 놓기는 차례로 하나씩 보낸다', async () => {
    let inFlight = 0;
    let most = 0;
    let impl: Partial<TeacherApi> = {};
    const { srv, actions } = await setup(teacherView([3, 2]), {
      putArrangement: async (...args) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight -= 1;
        return impl.putArrangement!(...args);
      },
    });
    impl = srv.impl;
    const first = actions.nudgeArtwork(A(0, 0), 1);
    const second = actions.nudgeArtwork(A(1, 0), 1);
    await Promise.all([first, second]);
    expect(most).toBe(1);
    expect(srv.named('putArrangement')).toHaveLength(2);
  });

  it('전시실 판 순서: 바꾸기 전 순서(base)를 함께 보내고, 되돌리기는 맞바꿔 보낸다', async () => {
    const view = teacherView([1, 1]);
    view.rooms = [teacherRoom(0), teacherRoom(1), teacherRoom(2)];
    const { srv, actions } = await setup(view);
    const R2 = testRoomId(2);
    await actions.reorderRooms([R2, R0, R1]);
    expect(srv.named('reorderRooms')[0]?.args.slice(1)).toEqual([
      [R2, R0, R1],
      [R0, R1, R2],
    ]);
    await actions.undo();
    expect(srv.named('reorderRooms')[1]?.args.slice(1)).toEqual([
      [R0, R1, R2],
      [R2, R0, R1],
    ]);
    expect([...srv.state.rooms].sort((p, q) => p.order - q.order).map(r => r.id)).toEqual([R0, R1, R2]);
  });
});

describe('독립 검토(HT-11) 재현 시험', () => {
  /** 서버 응답을 늦추는 가짜(느린 학교망) */
  const slow = (impl: () => Partial<TeacherApi>, ms = 5): Partial<TeacherApi> => ({
    putArrangement: async (...args) => {
      await new Promise(r => setTimeout(r, ms));
      return impl().putArrangement!(...args);
    },
    patchArtwork: async (...args) => {
      await new Promise(r => setTimeout(r, ms));
      return impl().patchArtwork!(...args);
    },
  });

  it('H1: 같은 작품을 연달아 세 번 한 칸씩 — 거짓 충돌 없이 세 칸 간다', async () => {
    let impl: Partial<TeacherApi> = {};
    const { srv, actions } = await setup(
      teacherView([4, 1]),
      slow(() => impl),
    );
    impl = srv.impl;
    await Promise.all([1, 2, 3].map(() => actions.nudgeArtwork(A(0, 0), 1)));
    expect(useTeacherStore.getState().toast?.text).not.toBe(errorCopy.E_CONFLICT);
    expect(serverBoard(srv).find(c => c.roomId === R0)?.ids).toEqual([A(0, 1), A(0, 2), A(0, 3), A(0, 0)]);
    expect(board()).toEqual(serverBoard(srv));
  });

  it('H3: 학교망이 끊겨 놓기와 새로 불러오기가 모두 실패하면 놓기 전 모습으로 돌아온다', async () => {
    const { AppError } = await import('@gallery/core/errors');
    const over: Partial<TeacherApi> = {};
    const { actions } = await setup(teacherView([3, 2]), over);
    const start = board();
    // 이제부터 끊김(가짜 서버의 바꿔 끼우는 메서드는 부를 때 읽는다)
    over.putArrangement = async () => {
      throw new AppError('E_OFFLINE');
    };
    over.exhibition = async () => {
      throw new AppError('E_OFFLINE');
    };
    await actions.moveArtworks([A(0, 0)], R1, 0);
    expect(board()).toEqual(start);
    expect(useTeacherStore.getState().toast?.text).toBe(errorCopy.E_OFFLINE);
  });

  it('M1: 놓기 답이 오기 전에 되돌리면 그 놓기를 되돌린다', async () => {
    let impl: Partial<TeacherApi> = {};
    const { srv, actions } = await setup(
      teacherView([3, 2]),
      slow(() => impl, 15),
    );
    impl = srv.impl;
    const start = serverBoard(srv);
    const moving = actions.moveArtworks([A(0, 0)], R1, 0);
    const undoing = actions.undo();
    await Promise.all([moving, undoing]);
    expect(serverBoard(srv)).toEqual(start);
    expect(useTeacherStore.getState().toast?.text).toBe(copy.teacher.undo.undone);
  });

  it('M2: 놓기 답을 기다리는 동안 같은 판 작품을 고쳐도 스스로 충돌하지 않는다', async () => {
    let impl: Partial<TeacherApi> = {};
    const { srv, actions } = await setup(
      teacherView([3, 2]),
      slow(() => impl),
    );
    impl = srv.impl;
    const moving = actions.moveArtworks([A(0, 2)], R1, 0);
    const hiding = actions.patchArtwork(A(0, 0), { status: 'HIDDEN' });
    await Promise.all([moving, hiding]);
    expect(srv.state.artworks.find(x => x.id === A(0, 0))?.status).toBe('HIDDEN');
    expect(useTeacherStore.getState().toast?.text).not.toBe(errorCopy.E_CONFLICT);
  });

  it('M3: 옮긴 뒤 다른 작품을 지우고 되살려도(끝으로 감) 옮기기 되돌리기가 충돌하지 않는다', async () => {
    const { srv, actions } = await setup(teacherView([3, 1]));
    await actions.nudgeArtwork(A(0, 0), 2); // [1,2,0]
    await actions.deleteArtwork(A(0, 1)); // [2,0]
    await actions.undo(); // 되살림 → [2,0,1]
    await actions.undo(); // 옮기기 되돌리기 — 지금 배열에서 다시 계산해 놓기 전 차례로
    expect(useTeacherStore.getState().toast?.text).toBe(copy.teacher.undo.undone);
    expect(serverBoard(srv).find(c => c.roomId === R0)?.ids).toEqual([A(0, 0), A(0, 1), A(0, 2)]);
  });

  it('M4: 다른 기기가 이 판에 옮겨 넣은 작품은 새 작품이 아니라 충돌 — 말없이 덮지 않는다', async () => {
    const { srv, actions } = await setup(teacherView([3, 2]));
    // 다른 기기: 둘째 판 첫 작품을 첫 판으로
    const moved = srv.state.artworks.find(x => x.id === A(1, 0))!;
    moved.roomId = R0;
    moved.order = -1;
    await actions.nudgeArtwork(A(0, 0), 1);
    expect(useTeacherStore.getState().toast?.text).toBe(errorCopy.E_CONFLICT);
    expect(srv.named('putArrangement')[0]?.args[1]).toMatchObject({
      known: expect.arrayContaining([A(1, 0)]),
    });
  });

  it('L3: 고른 작품을 지우면 고른 목록에서도 빠진다', async () => {
    const { actions } = await setup(teacherView([3, 1]));
    useTeacherStore.getState().toggleSelect(A(0, 1));
    useTeacherStore.getState().toggleSelect(A(0, 2));
    await actions.deleteArtwork(A(0, 1));
    expect(useTeacherStore.getState().selected).toEqual([A(0, 2)]);
  });
});
