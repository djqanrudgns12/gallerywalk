import { config } from '@gallery/core/config';
import { copy, errorCopy, fill, roAfter } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
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

describe('전시 관리 화면', () => {
  it('불러오면 전시 이름·상태·삭제 예정일·전시실 칩·지금 전시실 작품, 게시가 있으면 주요 버튼 `전시 열기`', async () => {
    const { m } = await open();
    expect(m.q<HTMLInputElement>('[data-testid="exhibition-title"]')?.value).toBe(T_TITLE);
    expect(m.q('[data-testid="exhibition-status"]')?.textContent).toBe(copy.teacher.exhibitionStatus.DRAFT);
    expect(m.text()).toContain(T_ROOM_TITLES[0]);
    expect(m.text()).toContain(T_ROOM_TITLES[1]);
    expect(cellIds(m)).toEqual([A(0), A(1), A(2)]);
    const primary = m.q<HTMLButtonElement>('[data-testid="primary-open"]');
    expect(primary?.textContent).toBe(copy.teacher.manage.open);
    expect(primary?.disabled).toBe(false);
    expect(m.q('[data-testid="drop-strip"]')).not.toBeNull();
    expect(m.q('[data-testid="check-line"]')).toBeNull();
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

  it('카드 제목을 누르면 바로 입력, 입력이 멈추고 0.6초 뒤 자동 저장(그 전에는 보내지 않음)', async () => {
    const { m, srv } = await open();
    click(m.q('[data-testid="cell-0"] h3'));
    const input = m.q<HTMLInputElement>('[data-testid="inline-title"]');
    expect(input).not.toBeNull();
    // 편집 중 끌기를 꺼도 칸이 "잠김"으로 알려지면 안 된다(안의 제목 칸까지 잠긴 것으로 읽힘 — 교사 e2e에서 발견)
    expect(m.q('[data-testid="cell-0"]')?.getAttribute('aria-disabled')).not.toBe('true');
    typeInto(input, T_NEW_TITLE);
    await wait(AUTOSAVE_DELAY_MS / 2);
    expect(srv.named('patchArtwork')).toHaveLength(0);
    await wait(AUTOSAVE_DELAY_MS);
    expect(srv.named('patchArtwork').map(c => c.args.slice(1))).toEqual([[A(0), 1, { title: T_NEW_TITLE }]]);
    key(input, 'Enter');
    await flush();
    expect(m.q('[data-testid="inline-title"]')).toBeNull();
    expect(m.q('[data-testid="cell-0"] h3')?.textContent).toBe(T_NEW_TITLE);
  });

  it('순서 바꾸기: 카드에서 Alt+→, 패널의 `앞으로` — 전체 순서를 보내고 새로 불러온다', async () => {
    const { m, srv } = await open();
    const loads = srv.named('exhibition').length;
    key(m.q('[data-testid="cell-0"]'), 'ArrowRight', { altKey: true });
    await flush();
    expect(srv.named('reorderArtworks').map(c => c.args.slice(1))).toEqual([
      [testRoomId(0), [A(1), A(0), A(2)]],
    ]);
    expect(cellIds(m)).toEqual([A(1), A(0), A(2)]);
    expect(srv.named('exhibition')).toHaveLength(loads + 1);

    click(m.q('[data-testid="cell-2"]'));
    click(m.q('[data-testid="nudge-earlier"]'));
    await flush();
    expect(cellIds(m)).toEqual([A(1), A(2), A(0)]);
  });

  it('여러 장 고르기(Shift+누르기 → 고른 동안은 누를 때마다) → 아래 띠 `숨기기`·`전시실 옮기기`', async () => {
    const { m, srv } = await open();
    click(m.q('[data-testid="cell-0"]'), { shiftKey: true });
    click(m.q('[data-testid="cell-1"]'));
    const bar = m.q('[data-testid="batch-bar"]');
    expect(bar?.textContent).toContain(fill(copy.teacher.selectedCount, { n: 2 }));
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    click(buttonByText(bar!, copy.teacher.manage.batchHide));
    await flush();
    expect(srv.named('batchArtworks').map(c => c.args[1])).toEqual([{ action: 'HIDE', ids: [A(0), A(1)] }]);
    expect(m.q('[data-testid="batch-bar"]')).toBeNull();
    expect(m.all('[data-status="HIDDEN"]')).toHaveLength(2);

    click(m.q('[data-testid="cell-2"]'), { shiftKey: true });
    click(buttonByText(m.q('[data-testid="batch-bar"]')!, copy.teacher.manage.batchMove));
    click(buttonByText(m.q('[data-testid="batch-rooms"]')!, T_ROOM_TITLES[1]));
    await flush();
    expect(srv.named('batchArtworks')[1]?.args[1]).toEqual({
      action: 'MOVE',
      ids: [A(2)],
      roomId: testRoomId(1),
    });
    expect(cellIds(m)).toEqual([A(0), A(1)]);
  });

  it('작품 패널: 저장이 실패하면 칸 옆에 다시 시도, 누르면 다시 보낸다', async () => {
    let fails = 1;
    const { m, srv } = await open(teacherView(), {
      patchArtwork: async (_e, id, _rev, patch) => {
        if (fails-- > 0) throw new AppError('E_OFFLINE');
        return teacherArtwork(0, 1, { id, ...(patch as object), rev: 2 });
      },
    });
    click(m.q('[data-testid="cell-1"]'));
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
    expect(m.q('[data-testid="cell-1"] h3')?.textContent).toBe(T_NEW_TITLE);
  });

  it('삭제하면 바로 사라지고 토스트 `되살리기`(10초), 누르면 되살린다', async () => {
    const { m, srv } = await open();
    click(m.q('[data-testid="cell-1"]'));
    click(m.q('[data-testid="panel-delete"]'));
    await flush();
    expect(cellIds(m)).toEqual([A(0), A(2)]);
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    expect(srv.named('deleteArtwork').map(c => c.args.slice(1))).toEqual([[A(1), 1]]);
    const toast = m.q('[data-testid="teacher-toast"]');
    expect(toast?.textContent).toContain(copy.teacher.panel.deleted);
    expect(useTeacherStore.getState().toast?.ms).toBe(config().UNDO_DELETE_SEC * 1000);
    click(buttonByText(toast!, copy.teacher.panel.restore));
    await flush();
    expect(srv.named('restoreArtwork').map(c => c.args[1])).toEqual([A(1)]);
    expect(cellIds(m)).toEqual([A(0), A(1), A(2)]);
    expect(m.q('[data-testid="teacher-toast"]')).toBeNull();
  });

  it('전시실 시트: 지금 전시실 칩을 다시 누르면 열림, 작품이 있으면 옮겨짐을 확인한 뒤 지운다', async () => {
    const { m, srv } = await open();
    click(m.q('[data-testid="room-chip-0"]'));
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
    expect(m.all('[data-room-chip]')).toHaveLength(1);
    expect(cellIds(m)).toEqual([testArtworkId(1, 0), A(0), A(1), A(2)]);
  });

  it('다른 곳에서 바뀌었으면(E_CONFLICT) 알리고 새로 불러온다', async () => {
    const { m, srv } = await open();
    const loads = srv.named('exhibition').length;
    srv.state.artworks[0]!.rev = 7;
    srv.state.artworks[0]!.title = T_NEW_TITLE;
    click(m.q('[data-testid="cell-0"] h3'));
    typeInto(m.q('[data-testid="inline-title"]'), 'x');
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(m.q('[data-testid="teacher-toast"]')?.textContent).toContain(errorCopy.E_CONFLICT);
    expect(srv.named('exhibition')).toHaveLength(loads + 1);
    expect(useTeacherStore.getState().view?.artworks[0]?.rev).toBe(7);
  });

  it('점검 줄: 제목 없음·흐림 수, 누르면 그 전시실의 그 카드로', async () => {
    const view = teacherView([1, 2]);
    view.artworks[2]!.title = '';
    view.artworks[1]!.warnings = ['LOW_RES'];
    const { m } = await open(view);
    const line = m.q('[data-testid="check-line"]');
    expect(line?.textContent).toContain(fill(copy.teacher.manage.checkUntitled, { n: 1 }));
    expect(line?.textContent).toContain(fill(copy.teacher.manage.checkBlurry, { n: 1 }));
    click(buttonByText(line!, fill(copy.teacher.manage.checkUntitled, { n: 1 })));
    expect(useTeacherStore.getState().roomId).toBe(testRoomId(1));
    expect(useTeacherStore.getState().flashId).toBe(testArtworkId(1, 1));
  });

  it('파일 두 장을 고르면 지금 전시실 끝에 올라가고 격자에 들어온다(진행 목록에 결과)', async () => {
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
    expect(cellIds(m)).toHaveLength(5);
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
    click(m.q('[data-testid="cell-0"]'));
    expect(m.q('[data-testid="artwork-panel"]')).not.toBeNull();
    click(m.q('[data-testid="manage-menu-trigger"]'));
    await flush();
    expect(m.q('[data-testid="artwork-panel"]')).toBeNull();
    expect(m.q('[data-testid="manage-menu"]')).not.toBeNull();
    click(m.q('[data-testid="cell-1"]'));
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
    // 미리 보기 동안에도 카드 제목을 고치면(묶음이 바뀜) 저장 뒤 다시 받는다
    click(m.q('[data-testid="cell-0"] h3'));
    typeInto(m.q('[data-testid="inline-title"]'), T_NEW_TITLE);
    await wait(AUTOSAVE_DELAY_MS + 50);
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
