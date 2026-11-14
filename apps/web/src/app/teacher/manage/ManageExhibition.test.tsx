import { config } from '@gallery/core/config';
import { copy, errorCopy, fill, roAfter } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { testArtworkId, testExhibitionView, testRoomId } from '../../../dev/testView.ts';
import {
  fakeTeacherServer,
  pngFile,
  SYNTH_FILE_NAMES as N,
  teacherArtwork,
  teacherView,
  T_ARRIVAL,
  T_NEW_TITLE,
  T_ROOM_TITLES,
  T_TITLE,
} from '../../../dev/teacherFixtures.ts';
import {
  buttonByText,
  click,
  flush,
  key,
  mountManage,
  pickFiles,
  typeInto,
  wait,
} from '../../../dev/teacherDom.tsx';
import type { TeacherApi } from '../../../ports/index.ts';
import { AUTOSAVE_DELAY_MS } from './AutosaveField.tsx';
import { useTeacherStore } from './teacherStore.ts';

let mounted: ReturnType<typeof mountManage> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const open = async (view = teacherView(), over: Partial<TeacherApi> = {}) => {
  const srv = fakeTeacherServer(view, over);
  mounted = mountManage(srv.api);
  await flush();
  return { srv, m: mounted };
};

const cellIds = (m: ReturnType<typeof mountManage>) => m.all('[data-cell-id]').map(c => c.dataset.cellId);
const A = (i: number) => testArtworkId(0, i);
/** 보드의 액자(작품 ID로) */
const cell = (m: ReturnType<typeof mountManage>, id: string) => m.q(`[data-cell-id="${id}"]`);

describe('전시 관리 화면', () => {
  it('불러오면 돌 바탕 틀·전시 이름·상태 알약·모든 전시실 판·요약 줄, 게시가 있으면 주요 버튼 `전시 열기`', async () => {
    const { m } = await open();
    expect(m.q('[data-testid="teacher-manage"]')?.getAttribute('data-surface')).toBe('manage');
    expect(m.q<HTMLInputElement>('[data-testid="exhibition-title"]')?.value).toBe(T_TITLE);
    expect(m.q('[data-testid="exhibition-status"]')?.textContent).toContain(
      copy.teacher.exhibitionStatus.DRAFT,
    );
    expect(m.all('[data-testid^="room-board-"]')).toHaveLength(2);
    expect(m.text()).toContain(T_ROOM_TITLES[0]);
    expect(m.text()).toContain(T_ROOM_TITLES[1]);
    expect(cellIds(m)).toEqual([A(0), A(1), A(2), testArtworkId(1, 0)]);
    const summary = m.q('[data-testid="summary"]');
    expect(summary?.textContent).toContain('4');
    expect(summary?.textContent).toContain(copy.teacher.manage.statRooms);
    const primary = m.q<HTMLButtonElement>('[data-testid="primary-open"]');
    expect(primary?.textContent).toBe(copy.teacher.manage.open);
    expect(primary?.disabled).toBe(false);
    // 작품이 있으면 옛 놓기 띠 대신 `작품 올리기` 차림표(파일·폴더·글 붙여넣기)
    expect(m.q('[data-testid="drop-strip"]')).toBeNull();
    click(m.q('[data-testid="summary-upload"]'));
    expect(m.q('[data-testid="upload-menu"]')?.textContent).toContain(copy.teacher.upload.pasteText);
    expect(m.q('[data-testid="check-chip"]')).toBeNull();
    // 오른쪽 칸: 고른 작품이 없으면 전시 지도 자리
    expect(m.q('[data-testid="manage-side"]')?.textContent).toContain(copy.teacher.manage.mapLabel);
  });

  it('열린 전시면 주요 버튼이 `QR·주소 다시 보기`(누르면 같은 시트)', async () => {
    const v = teacherView();
    v.exhibition.status = 'OPEN';
    const { m } = await open(v);
    const primary = m.q<HTMLButtonElement>('[data-testid="primary-open"]');
    expect(primary?.textContent).toBe(copy.teacher.menu.showQr);
    click(primary);
    await flush();
    expect(useTeacherStore.getState().overlay).toEqual({ kind: 'open' });
  });

  it('작품이 없으면 큰 놓기 영역과 `작품 올리기`, 게시가 0이면 `전시 열기` 잠김 + 안내', async () => {
    const { m } = await open(teacherView([0, 0]));
    expect(m.q('[data-testid="drop-big"]')?.textContent).toContain(copy.teacher.upload.dropTitle);
    expect(m.q('[data-testid="primary-upload"]')?.textContent).toBe(copy.teacher.manage.upload);
    m.unmount();
    const hidden = teacherView([1]);
    hidden.artworks[0]!.status = 'HIDDEN';
    mounted = mountManage(fakeTeacherServer(hidden).api);
    await flush();
    expect(mounted.q<HTMLButtonElement>('[data-testid="primary-open"]')?.disabled).toBe(true);
    expect(mounted.text()).toContain(errorCopy.E_NOTHING_PUBLISHED);
  });

  it('액자를 누르면 오른쪽 칸에 살펴보기, 제목 칸은 입력이 멈추고 0.6초 뒤 자동 저장', async () => {
    const { m, srv } = await open();
    click(cell(m, A(0)));
    expect(m.q('[data-testid="artwork-panel"]')?.getAttribute('data-artwork-id')).toBe(A(0));
    expect(cell(m, A(0))?.getAttribute('aria-current')).toBe('true');
    typeInto(m.q('[data-testid="panel-title"]'), T_NEW_TITLE);
    await wait(AUTOSAVE_DELAY_MS / 2);
    expect(srv.named('patchArtwork')).toHaveLength(0);
    await wait(AUTOSAVE_DELAY_MS);
    expect(srv.named('patchArtwork').map(c => c.args.slice(1))).toEqual([[A(0), 1, { title: T_NEW_TITLE }]]);
  });

  it('액자 크기 `크게/작게`는 기기에 기억한다', async () => {
    const { m } = await open();
    expect(m.q('[data-frame]')?.getAttribute('data-size')).toBe('big');
    click(buttonByText(m.q('[data-testid="summary"]')!, copy.teacher.manage.sizeSmall));
    await flush();
    expect(m.q('[data-frame]')?.getAttribute('data-size')).toBe('small');
    expect(m.device.manageFrameSize()).toBe('small');
  });

  it('순서 바꾸기: 액자에서 Alt+→, 패널의 `앞으로` — 한 번에 놓기로 보내고 새로 불러온다', async () => {
    const { m, srv } = await open();
    const loads = srv.named('exhibition').length;
    key(cell(m, A(0)), 'ArrowRight', { altKey: true });
    await flush();
    // 한 번에 놓기(ADR-074): 바뀐 판만, 바꾸기 전 배열과 함께
    expect(srv.arranged()).toEqual([[{ roomId: testRoomId(0), ids: [A(1), A(0), A(2)] }]]);
    expect(srv.named('putArrangement')[0]?.args[1]).toMatchObject({
      base: [{ roomId: testRoomId(0), ids: [A(0), A(1), A(2)] }],
    });
    expect(cellIds(m).slice(0, 3)).toEqual([A(1), A(0), A(2)]);
    expect(srv.named('exhibition')).toHaveLength(loads + 1);

    click(cell(m, A(2)));
    click(m.q(`[data-testid="artwork-panel"] button[aria-label="${copy.teacher.panel.earlier}"]`));
    await flush();
    expect(cellIds(m).slice(0, 3)).toEqual([A(1), A(2), A(0)]);
  });

  it('편집 되돌리기(HT-08): 순서를 바꾼 뒤 Ctrl+Z면 처음 순서로, 글 칸 안의 Ctrl+Z는 그 칸 몫', async () => {
    const { m, srv } = await open();
    key(cell(m, A(0)), 'ArrowRight', { altKey: true });
    await flush();
    expect(cellIds(m).slice(0, 3)).toEqual([A(1), A(0), A(2)]);
    expect(useTeacherStore.getState().toast?.action?.label).toBe(copy.teacher.undo.action);

    key(m.q('[data-testid="exhibition-title"]'), 'z', { ctrlKey: true });
    await flush();
    expect(srv.arranged()).toHaveLength(1);

    key(window.document.body, 'z', { ctrlKey: true });
    await flush();
    expect(srv.arranged()).toEqual([
      [{ roomId: testRoomId(0), ids: [A(1), A(0), A(2)] }],
      [{ roomId: testRoomId(0), ids: [A(0), A(1), A(2)] }],
    ]);
    expect(cellIds(m).slice(0, 3)).toEqual([A(0), A(1), A(2)]);
    expect(useTeacherStore.getState().toast?.text).toBe(copy.teacher.undo.undone);
  });

  it('여러 개 고르기(Shift+누르기 → 고른 동안은 누를 때마다) → 아래 띠 `숨기기`·`전시실 옮기기`', async () => {
    const { m, srv } = await open();
    click(cell(m, A(0)), { shiftKey: true });
    click(cell(m, A(1)));
    const bar = m.q('[data-testid="batch-bar"]');
    expect(bar?.textContent).toContain(fill(copy.teacher.selectedCount, { n: 2 }));
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    click(buttonByText(bar!, copy.teacher.manage.batchHide));
    await flush();
    expect(srv.named('batchArtworks').map(c => c.args[1])).toEqual([{ action: 'HIDE', ids: [A(0), A(1)] }]);
    expect(m.q('[data-testid="batch-bar"]')).toBeNull();
    expect(m.all('[data-status="HIDDEN"]')).toHaveLength(2);

    click(cell(m, A(2)), { shiftKey: true });
    click(buttonByText(m.q('[data-testid="batch-bar"]')!, copy.teacher.manage.batchMove));
    click(buttonByText(m.q('[data-testid="batch-rooms"]')!, T_ROOM_TITLES[1]));
    await flush();
    // 여러 개 옮기기도 한 번에 놓기로: 옮긴 곳 끝에
    expect(srv.arranged()).toEqual([
      [
        { roomId: testRoomId(0), ids: [A(0), A(1)] },
        { roomId: testRoomId(1), ids: [testArtworkId(1, 0), A(2)] },
      ],
    ]);
    expect(cellIds(m)).toEqual([A(0), A(1), testArtworkId(1, 0), A(2)]);
  });

  it('`여러 개 고르기` 단추: 누르면 누를 때마다 고르기, 다시 누르면 풀린다', async () => {
    const { m } = await open();
    click(m.q('[data-testid="select-many"]'));
    click(cell(m, A(1)));
    expect(useTeacherStore.getState().selected).toEqual([A(1)]);
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    click(m.q('[data-testid="select-many"]'));
    expect(useTeacherStore.getState().selected).toEqual([]);
  });

  it('작품 패널: 저장이 실패하면 칸 옆에 다시 시도, 누르면 다시 보낸다', async () => {
    let fails = 1;
    const { m, srv } = await open(teacherView(), {
      patchArtwork: async (_e, id, _rev, patch) => {
        if (fails-- > 0) throw new AppError('E_OFFLINE');
        return teacherArtwork(0, 1, { id, ...(patch as object), rev: 2 });
      },
    });
    click(cell(m, A(1)));
    expect(m.q('[data-testid="artwork-panel"]')?.getAttribute('data-artwork-id')).toBe(A(1));
    typeInto(m.q('[data-testid="panel-title"]'), T_NEW_TITLE);
    await wait(AUTOSAVE_DELAY_MS + 100);
    const retry = m.q('[data-testid="panel-title-retry"]');
    expect(retry?.textContent).toBe(copy.teacher.manage.retrySave);
    expect(m.text()).toContain(copy.teacher.manage.saveFailed);
    click(retry);
    await flush();
    expect(srv.named('patchArtwork')).toHaveLength(2);
    expect(m.q('[data-testid="panel-title-retry"]')).toBeNull();
    expect(useTeacherStore.getState().view?.artworks.find(a => a.id === A(1))?.title).toBe(T_NEW_TITLE);
  });

  it('삭제하면 바로 사라지고 토스트 `되살리기`(10초), 누르면 되살린다', async () => {
    const { m, srv } = await open();
    click(cell(m, A(1)));
    click(m.q('[data-testid="panel-delete"]'));
    await flush();
    expect(cellIds(m).slice(0, 2)).toEqual([A(0), A(2)]);
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    expect(srv.named('deleteArtwork').map(c => c.args.slice(1))).toEqual([[A(1), 1]]);
    const toast = m.q('[data-testid="teacher-toast"]');
    expect(toast?.textContent).toContain(copy.teacher.panel.deleted);
    expect(useTeacherStore.getState().toast?.ms).toBe(config().UNDO_DELETE_SEC * 1000);
    click(buttonByText(toast!, copy.teacher.panel.restore));
    await flush();
    expect(srv.named('restoreArtwork').map(c => c.args[1])).toEqual([A(1)]);
    expect(cellIds(m).slice(0, 3)).toEqual([A(0), A(1), A(2)]);
    expect(m.q('[data-testid="teacher-toast"]')).toBeNull();
  });

  it('전시실 시트: 판의 `고치기`로 열림, 작품이 있으면 옮겨짐을 확인한 뒤 지운다', async () => {
    const { m, srv } = await open();
    click(m.q(`[data-testid="room-edit-${testRoomId(0)}"]`));
    expect(m.q('[data-testid="room-sheet"]')?.getAttribute('data-room-id')).toBe(testRoomId(0));
    click(m.q('[data-testid="room-delete"]'));
    expect(srv.named('deleteRoom')).toHaveLength(0);
    const confirm = m.q('[data-testid="room-delete-confirm"]');
    const to = T_ROOM_TITLES[1];
    expect(confirm?.textContent).toContain(
      fill(copy.teacher.roomSheet.deleteConfirm, { n: 3, room: to, ro: roAfter(to) }),
    );
    click(m.q('[data-testid="room-delete-yes"]'));
    await flush();
    expect(srv.named('deleteRoom').map(c => c.args.slice(1))).toEqual([[testRoomId(0), 1]]);
    expect(m.q('[data-testid="room-sheet"]')).toBeNull();
    expect(m.all('[data-testid^="room-board-"]')).toHaveLength(1);
    expect(cellIds(m)).toEqual([testArtworkId(1, 0), A(0), A(1), A(2)]);
  });

  it('다른 곳에서 바뀌었으면(E_CONFLICT) 알리고 새로 불러온다', async () => {
    const { m, srv } = await open();
    const loads = srv.named('exhibition').length;
    srv.state.artworks[0]!.rev = 7;
    srv.state.artworks[0]!.title = T_NEW_TITLE;
    click(cell(m, A(0)));
    typeInto(m.q('[data-testid="panel-title"]'), 'x');
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(m.q('[data-testid="teacher-toast"]')?.textContent).toContain(errorCopy.E_CONFLICT);
    expect(srv.named('exhibition')).toHaveLength(loads + 1);
    expect(useTeacherStore.getState().view?.artworks[0]?.rev).toBe(7);
  });

  it('확인할 것 칩: 제목 없음·흐림 수(작은 그림 겹침), 누르면 보드 차례 첫 작품을 살펴본다', async () => {
    const view = teacherView([1, 2]);
    view.artworks[2]!.title = '';
    view.artworks[1]!.warnings = ['LOW_RES'];
    const { m } = await open(view);
    const chip = m.q('[data-testid="check-chip"]');
    expect(chip?.textContent).toContain('2');
    expect(chip?.textContent).toContain(copy.teacher.manage.checkCount);
    expect(chip?.querySelectorAll('[data-frame]')).toHaveLength(2);
    expect(m.all('[data-frame][data-flag="true"]')).toHaveLength(2);
    click(chip);
    expect(useTeacherStore.getState().flashId).toBe(testArtworkId(1, 0));
    expect(useTeacherStore.getState().overlay).toEqual({ kind: 'artwork', id: testArtworkId(1, 0) });
  });

  it('파일 두 장을 고르면 올릴 전시실 끝에 올라가고 보드에 들어온다(진행 목록에 결과)', async () => {
    const { m, srv } = await open();
    pickFiles(m.q('[data-testid="pick-files"]'), [
      pngFile(N.first, 1200, 900, 1),
      pngFile(N.second, 640, 900, 2),
    ]);
    await wait(50);
    const metas = srv
      .named('uploadArtwork')
      .map(c => c.args[1] as { roomId: string; order: number; title: string });
    expect(metas.map(x => [x.roomId, x.order, x.title])).toEqual([
      [testRoomId(0), 3, '가상 그림'],
      [testRoomId(0), 4, '합성 풍경'],
    ]);
    expect(m.all('[data-testid="upload-row"]').map(r => r.dataset.phase)).toEqual(['done', 'done']);
    expect(m.all('[data-testid="upload-row"]')[1]?.textContent).toContain(copy.teacher.upload.lowRes);
    // v3 보드는 모든 판을 그린다 — 올린 두 장은 첫 판 끝
    expect(m.all(`[data-testid="room-wall-${testRoomId(0)}"] [data-cell-id]`)).toHaveLength(5);
  });

  it('막힌 파일은 올리지 않고 이유와 해결법 한 줄', async () => {
    const { m, srv } = await open();
    pickFiles(m.q('[data-testid="pick-files"]'), [new File([new Uint8Array(8)], N.pdf)]);
    await wait(50);
    const row = m.q('[data-testid="upload-row"]');
    expect(row?.dataset.phase).toBe('blocked');
    // 이름만 PDF인 빈 파일: 열 수 없음 + PDF 해결법
    expect(row?.textContent).toContain(errorCopy.E_FILE_BROKEN);
    expect(row?.textContent).toContain(copy.teacher.upload.fix.pdfBroken);
    expect(srv.named('uploadArtwork')).toHaveLength(0);
  });

  it('새 전시 만들기에서 넘겨준 토스트를 들어오자마자 보인다', async () => {
    const srv = fakeTeacherServer();
    mounted = mountManage(srv.api, undefined, { toast: T_ARRIVAL });
    await flush();
    expect(mounted.q('[data-testid="teacher-toast"]')?.textContent).toContain(T_ARRIVAL);
  });

  it('창은 하나: `···` 메뉴를 열면 패널이 닫히고, 패널을 열면 메뉴가 닫힌다', async () => {
    const { m } = await open();
    click(cell(m, A(0)));
    expect(m.q('[data-testid="artwork-panel"]')).not.toBeNull();
    click(m.q('[data-testid="manage-menu-trigger"]'));
    await flush();
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    expect(m.q('[data-testid="manage-menu"]')).not.toBeNull();
    click(cell(m, A(1)));
    await flush();
    expect(m.q('[data-testid="artwork-panel"]')).not.toBeNull();
    expect(m.q('[data-testid="manage-menu"]')).toBeNull();
  });

  it('`미리 보기`(P5-6): 게시 작품이 있을 때만, 열면 전체 화면 층 → 배치가 아직 없으면 안내 + 닫기', async () => {
    const { m, srv } = await open();
    const before = srv.named('exhibition').length;
    click(m.q('[data-testid="open-preview"]'));
    const layer = async () => {
      for (let i = 0; i < 100 && !m.q('[data-testid="preview-layer"] [data-state="empty"]'); i++)
        await wait(10);
      return m.q('[data-testid="preview-layer"]');
    };
    expect((await layer())?.textContent).toContain(copy.teacher.manage.previewEmpty);
    // 학생 화면과 같은 배치를 보이려고 미리 보기는 서버에서 새로 받는다
    expect(srv.named('exhibition').length).toBe(before + 1);
    click(m.q('[data-testid="preview-close"]'));
    expect(m.q('[data-testid="preview-layer"]')).toBeNull();
    m.unmount();
    const hidden = teacherView([1]);
    hidden.artworks[0]!.status = 'HIDDEN';
    mounted = mountManage(fakeTeacherServer(hidden).api);
    await flush();
    expect(mounted.q('[data-testid="open-preview"]')).toBeNull();
  });

  it('`미리 보기`: 배치가 있으면 학생 관람 화면을 띄운다(WebGL이 없는 기기는 3D 안내), 고치면 잠시 뒤 다시 받는다', async () => {
    const v = teacherView();
    v.layout = testExhibitionView([3, 1]).layout;
    const { m, srv } = await open(v);
    click(m.q('[data-testid="open-preview"]'));
    for (let i = 0; i < 200 && !m.q('[data-testid="preview-layer"] [data-state="no3d"]'); i++) await wait(10);
    expect(m.q('[data-testid="preview-layer"]')?.textContent).toContain(copy.teacher.manage.previewNo3d);
    const fetched = srv.named('exhibition').length;
    // 미리 보기 동안에도 작품이 바뀌면(묶음이 바뀜) 잠시 뒤 다시 받는다
    act(() => {
      const art = useTeacherStore.getState().view?.artworks[0];
      if (art) useTeacherStore.getState().upsertArtwork({ ...art, title: T_NEW_TITLE, rev: art.rev + 1 });
    });
    await wait(AUTOSAVE_DELAY_MS / 2);
    expect(srv.named('exhibition').length).toBe(fetched);
    await wait(config().AUTOSAVE_DELAY_MS + 50);
    expect(srv.named('exhibition').length).toBeGreaterThan(fetched);
    // Esc(걷는 중)로 닫는다
    key(window.document.body, 'Escape');
    expect(m.q('[data-testid="preview-layer"]')).toBeNull();
  });

  it('토큰이 없으면(E_AUTH) 다시 들어오라는 안내와 첫 화면으로', async () => {
    const { m } = await open(teacherView(), {
      exhibition: async () => {
        throw new AppError('E_AUTH');
      },
    });
    expect(m.text()).toContain(errorCopy.E_AUTH);
    click(buttonByText(m.container, copy.teacher.manage.goHome));
    await flush();
    expect(m.q('[data-testid="teacher-home"]')).not.toBeNull();
  });
});

describe('전시 관리 화면 — 키(HT-09)·좁은 화면(HT-10 준비)·지도에 놓기(HT-03d)', () => {
  it('액자 키: ←/→ 이웃 액자(살펴보는 중이면 그 작품), H 숨기기, Delete 삭제, ? 도움말', async () => {
    const { m, srv } = await open();
    click(cell(m, A(0)));
    key(cell(m, A(0)), 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-cell-id')).toBe(A(1));
    expect(useTeacherStore.getState().overlay).toEqual({ kind: 'artwork', id: A(1) });

    key(cell(m, A(1)), 'h', { code: 'KeyH' });
    await flush();
    expect(srv.named('patchArtwork').map(c => c.args.slice(1))).toEqual([[A(1), 1, { status: 'HIDDEN' }]]);

    key(cell(m, A(2)), 'Delete', { code: 'Delete' });
    await flush();
    expect(srv.named('deleteArtwork').map(c => c.args[1])).toEqual([A(2)]);

    key(cell(m, A(0)), '?', { code: 'Slash', shiftKey: true });
    expect(m.q('[data-testid="keys-help"]')?.textContent).toContain(copy.teacher.keys.title);
    key(window.document.body, 'Escape');
    expect(m.q('[data-testid="keys-help"]')).toBeNull();
  });

  it('휴대폰: 판을 접고(처음엔 첫 판만 펼침, 접힌 판은 표지 그림), 누르면 펼친다. 살펴보기에 닫기 단추', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      const { m } = await open();
      const second = m.q(`[data-testid="room-board-${testRoomId(1)}"]`);
      expect(m.q(`[data-testid="room-board-${testRoomId(0)}"]`)?.getAttribute('data-collapsed')).toBe(
        'false',
      );
      expect(second?.getAttribute('data-collapsed')).toBe('true');
      expect(second?.querySelectorAll('[data-cell-id]')).toHaveLength(0);
      expect(second?.querySelectorAll('[data-frame]')).toHaveLength(1);
      click(m.q(`[data-testid="room-fold-${testRoomId(1)}"]`));
      expect(second?.getAttribute('data-collapsed')).toBe('false');
      expect(m.all('[data-cell-id]')).toHaveLength(4);
      // 지도는 수업 탭에만(오른쪽 칸 지도·태블릿 띠 없음)
      expect(m.q('[data-testid="drop-map"]')).toBeNull();
      click(cell(m, A(0)));
      expect(m.q('[data-testid="manage-side"] button[aria-label]')?.getAttribute('aria-label')).toBe(
        copy.teacher.manage.sideClose,
      );
    } finally {
      window.matchMedia = original;
    }
  });

  it('지도에 놓기 판정: 지도 SVG 위 화면 좌표 → 그 전시실(SVG가 줄어 그려져도), 바깥이면 null', async () => {
    const { buildAxo, project } = await import('../../../viewer/map/axo.ts');
    const { hitMap } = await import('./ManageExhibition.tsx');
    const v = testExhibitionView([3, 1]);
    const roomOrder = [testRoomId(0), testRoomId(1)];
    const model = buildAxo(
      {
        map: v.layout.map,
        parts: v.layout.parts,
        frames: v.layout.frames,
        facadeZ: v.layout.exterior.facadeZ,
        roomOrder,
      },
      { width: 380, height: 260 },
    );
    const el = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.append(svg);
    // 화면에는 절반 크기로, (100, 50)에서 시작
    svg.getBoundingClientRect = () =>
      ({ left: 100, top: 50, right: 290, bottom: 180, width: 190, height: 130 }) as DOMRect;
    for (const part of v.layout.map.parts) {
      const roomId = v.layout.parts.find(p => p.partId === part.partId)?.roomId;
      const [u, w] = project(part.labelPos[0], part.labelPos[1]);
      const sx = model.internal.ox + u * model.scale;
      const sy = model.internal.oy + w * model.scale;
      expect(hitMap({ model, el }, { x: 100 + sx / 2, y: 50 + sy / 2 })).toBe(roomId);
    }
    expect(hitMap({ model, el }, { x: 20, y: 20 })).toBeNull();
    expect(hitMap({ model: null, el }, { x: 150, y: 100 })).toBeNull();
  });
});
