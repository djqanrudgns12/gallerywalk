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
const save = () => click(document.querySelector('[data-testid="paste-save"]'));
const BODY = '첫째 줄 가상 글\n\n둘째 줄 가상 글';
const TITLE = '01_가상 시 한 편';

describe('글 붙여넣기', () => {
  it('얇은 띠와 빈 상태 큰 영역 아래 모두 `글 붙여넣기` 링크가 있고, 누르면 시트가 열린다', async () => {
    const { m } = await open();
    const link = m.q('[data-testid="paste-open"]');
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
    click(m.q('[data-testid="paste-open"]'));
    typeInto(bodyInput(), BODY);
    save();
    await flush();
    expect(sheet()?.textContent).toContain(copy.teacher.paste.titleRequired);
    expect(srv.named('createArtwork')).toHaveLength(0);
    expect(m.all('[data-testid="upload-row"]')).toHaveLength(0);
  });

  it(`본문이 ${config().TEXT_MAX_CHARS}자를 넘으면 막힌다`, async () => {
    const { m, srv } = await open();
    click(m.q('[data-testid="paste-open"]'));
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

  it('저장하면 시트가 닫히고 올리기 줄에 글 작품 하나 — 제목 그대로, 줄바꿈 유지, 지금 전시실 끝', async () => {
    const { m, srv } = await open();
    click(m.q('[data-testid="paste-open"]'));
    typeInto(titleInput(), TITLE);
    typeInto(bodyInput(), BODY);
    save();
    expect(sheet()).toBeNull();
    await wait(50);
    const calls = srv.named('createArtwork');
    expect(calls).toHaveLength(1);
    const body = calls[0]?.args[1] as CreateJsonArtworkInput;
    expect(body).toMatchObject({ kind: 'TEXT', title: TITLE, roomId: testRoomId(0), order: 3 });
    expect(body.kind === 'TEXT' ? body.textBody : null).toBe(BODY);
    const rows = m.all('[data-testid="upload-row"]');
    expect(rows.map(r => r.dataset.phase)).toEqual(['done']);
    expect(m.all('[data-cell-id]')).toHaveLength(4);
    expect(m.q('[data-cell-id] [data-form="TEXTCARD"]')).not.toBeNull();
  });

  it('창은 하나: 시트를 열면 작품 패널이 닫히고, 다른 덮개가 열리면 시트가 닫힌다', async () => {
    const { m } = await open();
    useTeacherStore.getState().setOverlay({ kind: 'room', id: testRoomId(0) });
    await flush();
    click(m.q('[data-testid="paste-open"]'));
    await flush();
    expect(useTeacherStore.getState().overlay).toBeNull();
    expect(sheet()).not.toBeNull();
    useTeacherStore.getState().setOverlay({ kind: 'open' });
    await flush();
    expect(sheet()).toBeNull();
  });
});
