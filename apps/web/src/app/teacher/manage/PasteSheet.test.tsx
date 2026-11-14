import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { CreateJsonArtworkInput } from '../../../ports/index.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { testRoomId } from '../../../dev/testView.ts';
import { fakeTeacherServer, teacherView } from '../../../dev/teacherFixtures.ts';
import { click, flush, mountManage, typeInto, wait } from '../../../dev/teacherDom.tsx';
import { useTeacherStore } from './teacherStore.ts';

/** 글 붙여넣기(V-01, PRD G-10·15.3-5): 놓기 영역 아래 링크 → 시트 → 기존 올리기 줄의 글(TEXT) 작품 하나 */

let mounted: ReturnType<typeof mountManage> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const open = async (view = teacherView()) => {
  const srv = fakeTeacherServer(view);
  mounted = mountManage(srv.api);
  await flush();
  return { srv, m: mounted };
};

const sheet = () => document.querySelector<HTMLElement>('[data-testid="paste-sheet"]');
const titleInput = () => document.querySelector<HTMLInputElement>('[data-testid="paste-title"]');
const bodyInput = () => document.querySelector<HTMLTextAreaElement>('[data-testid="paste-body"]');
/** 작품이 있으면 `작품 올리기` 차림표 안, 없으면 큰 놓기 영역 아래에 있다 */
const pasteLink = (m: ReturnType<typeof mountManage>) => {
  if (!m.q('[data-testid="paste-open"]')) click(m.q('[data-testid="summary-upload"]'));
  return m.q('[data-testid="paste-open"]');
};
const save = () => click(document.querySelector('[data-testid="paste-save"]'));
const BODY = '첫째 줄 가상 글\n\n둘째 줄 가상 글';
const TITLE = '01_가상 시 한 편';

describe('글 붙여넣기', () => {
  it('`작품 올리기` 차림표와 빈 상태 큰 영역 아래 모두 `글 붙여넣기`가 있고, 누르면 시트가 열린다', async () => {
    const { m } = await open();
    const link = pasteLink(m);
    expect(link?.textContent).toBe(copy.teacher.upload.pasteText);
    click(link);
    expect(sheet()).not.toBeNull();
    expect(titleInput()?.maxLength).toBe(config().ARTWORK_TITLE_MAX_CHARS);
    m.unmount();
    mounted = mountManage(fakeTeacherServer(teacherView([0, 0])).api);
    await flush();
    expect(mounted.q('[data-testid="drop-big"]')).not.toBeNull();
    expect(mounted.q('[data-testid="paste-open"]')?.textContent).toBe(copy.teacher.upload.pasteText);
  });

  it('제목이 없으면 막히고 아무것도 보내지 않는다', async () => {
    const { m, srv } = await open();
    click(pasteLink(m));
    typeInto(bodyInput(), BODY);
    save();
    await flush();
    expect(sheet()?.textContent).toContain(copy.teacher.paste.titleRequired);
    expect(srv.named('createArtwork')).toHaveLength(0);
    expect(m.all('[data-testid="upload-row"]')).toHaveLength(0);
  });

  it(`본문이 ${config().TEXT_MAX_CHARS}자를 넘으면 막힌다`, async () => {
    const { m, srv } = await open();
    click(pasteLink(m));
    typeInto(titleInput(), TITLE);
    const max = config().TEXT_MAX_CHARS;
    typeInto(bodyInput(), '가'.repeat(max + 1));
    save();
    await flush();
    expect(sheet()?.textContent).toContain(fill(copy.teacher.paste.bodyTooLong, { max, n: max + 1 }));
    expect(srv.named('createArtwork')).toHaveLength(0);
    // 딱 한도면 들어간다
    typeInto(bodyInput(), '가'.repeat(max));
    save();
    await wait(50);
    expect(srv.named('createArtwork')).toHaveLength(1);
  });

  it('저장하면 시트가 닫히고 올리기 줄에 글 작품 하나 — 제목 그대로, 줄바꿈 유지, 올릴 전시실(고른 작품이 없으면 마지막 전시실) 끝', async () => {
    const { m, srv } = await open();
    click(pasteLink(m));
    typeInto(titleInput(), TITLE);
    typeInto(bodyInput(), BODY);
    save();
    expect(sheet()).toBeNull();
    await wait(50);
    const calls = srv.named('createArtwork');
    expect(calls).toHaveLength(1);
    const body = calls[0]?.args[1] as CreateJsonArtworkInput;
    expect(body).toMatchObject({ kind: 'TEXT', title: TITLE, roomId: testRoomId(1), order: 1 });
    expect(body.kind === 'TEXT' ? body.textBody : null).toBe(BODY);
    const rows = m.all('[data-testid="upload-row"]');
    expect(rows.map(r => r.dataset.phase)).toEqual(['done']);
    // v3 보드는 모든 판을 그린다 — 글 작품은 마지막 판 끝
    const wall = m.all(`[data-testid="room-wall-${testRoomId(1)}"] [data-cell-id]`);
    expect(wall).toHaveLength(2);
    const made = useTeacherStore.getState().view?.artworks.find(a => a.id === body.id);
    expect(made?.form).toBe('TEXTCARD');
    expect(wall[1]?.dataset.cellId).toBe(body.id);
  });

  it('창은 하나: 시트를 열면 작품 패널이 닫히고, 다른 덮개가 열리면 시트가 닫힌다', async () => {
    const { m } = await open();
    useTeacherStore.getState().setOverlay({ kind: 'room', id: testRoomId(0) });
    await flush();
    click(pasteLink(m));
    await flush();
    expect(useTeacherStore.getState().overlay).toBeNull();
    expect(sheet()).not.toBeNull();
    useTeacherStore.getState().setOverlay({ kind: 'open' });
    await flush();
    expect(sheet()).toBeNull();
  });
});
