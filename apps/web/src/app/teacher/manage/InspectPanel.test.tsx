import { copy, fill } from '@gallery/core/copy';
import type { ArtworkTeacher, Layout } from '@gallery/core/types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, key, typeInto, wait } from '../../../dev/teacherDom.tsx';
import { T_EX, teacherArtwork, teacherRoom } from '../../../dev/teacherFixtures.ts';
import { testExhibitionView, testRoomId } from '../../../dev/testView.ts';
import type { PatchArtworkInput } from '../../../ports/index.ts';
import { thumbOf } from './ArtworkBoard.tsx';
import { AUTOSAVE_DELAY_MS } from './AutosaveField.tsx';
import { InspectPanel, type InspectPanelProps } from './InspectPanel.tsx';

const p = copy.teacher.panel;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** 배치(걸린 자리 지도): 전시실 3개에 작품 4·3·5점, 보드 차례 = 전시실 0·1·2 */
const view = testExhibitionView([4, 3, 5]);
const layout: Layout = view.layout;
const rooms = [0, 1, 2].map(r => teacherRoom(r));
const roomCounts = new Map([
  [testRoomId(0), 4],
  [testRoomId(1), 3],
  [testRoomId(2), 5],
]);

interface Mounted {
  readonly el: HTMLDivElement;
  readonly props: InspectPanelProps;
  readonly q: <E extends Element = HTMLElement>(sel: string) => E | null;
  readonly qa: (sel: string) => Element[];
  readonly onPatch: ReturnType<typeof vi.fn<(patch: PatchArtworkInput) => Promise<void>>>;
}

const mount = (over: Partial<InspectPanelProps> = {}): Mounted => {
  const onPatch = vi.fn<(patch: PatchArtworkInput) => Promise<void>>(async () => undefined);
  const props: InspectPanelProps = {
    exhibitionId: T_EX,
    artwork: teacherArtwork(1, 1),
    rooms,
    roomCounts,
    index: 1,
    count: 3,
    layout,
    onPatch,
    onNudge: vi.fn(),
    onMoveRoom: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onPreviewHere: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<InspectPanel {...props} />));
  const el = host;
  return {
    el,
    props,
    q: <E extends Element = HTMLElement>(sel: string) => el.querySelector<E>(sel),
    qa: sel => [...el.querySelectorAll(sel)],
    onPatch: (over.onPatch as Mounted['onPatch'] | undefined) ?? onPatch,
  };
};

const switchNamed = (m: Mounted, name: string): HTMLButtonElement | null =>
  m.q<HTMLButtonElement>(`[role="switch"][aria-label="${name}"]`);
const roomTile = (m: Mounted, r: number) => m.q<HTMLButtonElement>(`[data-room-id="${testRoomId(r)}"]`);
const formChip = (m: Mounted, value: string) =>
  m.q<HTMLButtonElement>(`[role="radio"][data-value="${value}"]`);

/** 배치에서 조건에 맞는 액자 하나와 그 전시실 번호(0부터) */
const frameWhere = (pred: (f: Layout['frames'][number]) => boolean) => {
  const frame = layout.frames.find(pred);
  if (!frame) throw new Error('시험 배치에 맞는 액자가 없음');
  const roomId = layout.parts.find(part => part.partId === frame.partId)?.roomId ?? '';
  return { frame, roomId, r: rooms.findIndex(x => x.id === roomId) };
};
const artworkAt = (frame: Layout['frames'][number], roomId: string, over: Partial<ArtworkTeacher> = {}) =>
  teacherArtwork(0, 0, { id: frame.artworkId, roomId, ...over });

describe('InspectPanel', () => {
  it('접힌 칸 없이 감상 상자·글·번호 타일·순서·형태·토글·지도·아래 줄이 한꺼번에 보인다', () => {
    const m = mount();
    expect(m.qa('[aria-expanded]')).toHaveLength(0);
    expect(m.q('[data-testid="artwork-panel"]')?.getAttribute('aria-label')).toBe(p.inspectLabel);
    expect(m.q('[data-testid="inspect-stage"] [data-frame]')).not.toBeNull();
    expect(m.q('[data-testid="panel-title"]')).not.toBeNull();
    expect(m.qa('[data-testid="inspect-rooms"] [role="radio"]')).toHaveLength(3);
    expect(m.qa('[data-step]')).toHaveLength(2);
    expect(m.qa('[data-testid="inspect-form"] [role="radio"]')).toHaveLength(2);
    expect(m.qa('[role="switch"]').map(s => s.getAttribute('aria-label'))).toEqual([
      p.featured,
      p.visible,
      p.pageSingle,
      p.textHeavy,
    ]);
    expect(m.q('[data-testid="floor-plan"]')).not.toBeNull();
    expect(m.q('[data-testid="inspect-preview"]')?.textContent).toBe(p.previewHere);
    expect(m.q('[data-testid="panel-delete"]')?.textContent).toBe(p.delete);
  });

  it('감상 상자: 액자에 썸네일, 아래 작은 글 "02 · 2번째"', () => {
    const a = teacherArtwork(1, 1);
    const m = mount({ artwork: a });
    expect(m.q<HTMLImageElement>('[data-testid="inspect-stage"] img')?.getAttribute('src')).toBe(
      thumbOf(T_EX, a),
    );
    expect(m.q('[data-testid="inspect-position"]')?.textContent).toBe(fill(p.position, { no: '02', n: 2 }));
  });

  it('이전·다음: 누르면 부르고, null이면 잠긴다', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const m = mount({ onPrev, onNext });
    click(m.q('[data-testid="inspect-prev"]'));
    click(m.q('[data-testid="inspect-next"]'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    const locked = mount({ onPrev: null, onNext: null });
    expect(locked.q<HTMLButtonElement>('[data-testid="inspect-prev"]')?.disabled).toBe(true);
    expect(locked.q<HTMLButtonElement>('[data-testid="inspect-next"]')?.disabled).toBe(true);
    expect(locked.q('[data-testid="inspect-prev"]')?.getAttribute('aria-label')).toBe(p.prev);
  });

  it('전시실 번호 타일: 01~03·작품 수, 다른 전시실을 누르면 onMoveRoom 한 번, 지금 전시실은 그대로', () => {
    const onMoveRoom = vi.fn();
    const m = mount({ onMoveRoom });
    const tiles = m.qa('[data-testid="inspect-rooms"] [role="radio"]');
    expect(tiles.map(t => t.querySelector('b')?.textContent)).toEqual(['01', '02', '03']);
    expect(tiles.map(t => t.querySelector('small')?.textContent)).toEqual(['4점', '3점', '5점']);
    expect(roomTile(m, 1)?.getAttribute('aria-checked')).toBe('true');
    expect(roomTile(m, 2)?.getAttribute('aria-label')).toBe(
      fill(p.roomTile, { no: '03', name: rooms[2]?.title ?? '', n: 5 }),
    );
    click(roomTile(m, 1));
    expect(onMoveRoom).not.toHaveBeenCalled();
    click(roomTile(m, 2));
    expect(onMoveRoom).toHaveBeenCalledTimes(1);
    expect(onMoveRoom).toHaveBeenCalledWith(testRoomId(2));
  });

  it('번호 타일에서 화살표는 초점만 옮기고 옮기기는 하지 않는다', () => {
    const onMoveRoom = vi.fn();
    const m = mount({ onMoveRoom });
    const from = roomTile(m, 1);
    act(() => from?.focus());
    key(from, 'ArrowRight');
    expect(document.activeElement).toBe(roomTile(m, 2));
    key(roomTile(m, 2), 'Home');
    expect(document.activeElement).toBe(roomTile(m, 0));
    expect(onMoveRoom).not.toHaveBeenCalled();
  });

  it('처리 중인 작품은 번호 타일로 옮기지 않는다', () => {
    const onMoveRoom = vi.fn();
    const m = mount({ onMoveRoom, artwork: teacherArtwork(1, 1, { status: 'PROCESSING' }) });
    click(roomTile(m, 0));
    expect(onMoveRoom).not.toHaveBeenCalled();
  });

  it('순서: 큰 숫자 2 / 3, 앞뒤 단추는 onNudge(-1|1)', () => {
    const onNudge = vi.fn();
    const m = mount({ onNudge, index: 1, count: 3 });
    expect(m.q('[role="group"]')?.getAttribute('aria-label')).toBe(p.order);
    expect(m.q('[role="group"]')?.textContent).toContain(fill(p.orderValue, { total: 3, n: 2 }));
    click(m.q('[data-step="prev"]'));
    click(m.q('[data-step="next"]'));
    expect(onNudge.mock.calls).toEqual([[-1], [1]]);
  });

  it('순서: 첫 자리에서는 앞으로, 끝 자리에서는 뒤로가 잠긴다', () => {
    const first = mount({ index: 0, count: 3 });
    expect(first.q<HTMLButtonElement>('[data-step="prev"]')?.disabled).toBe(true);
    expect(first.q<HTMLButtonElement>('[data-step="next"]')?.disabled).toBe(false);
    act(() => root?.unmount());
    const last = mount({ index: 2, count: 3 });
    expect(last.q<HTMLButtonElement>('[data-step="prev"]')?.disabled).toBe(false);
    expect(last.q<HTMLButtonElement>('[data-step="next"]')?.disabled).toBe(true);
  });

  it('형태 칩: 자동이면 `자동` 표시, 세로를 누르면 onPatch({formOverride: PORTRAIT})', () => {
    const m = mount();
    expect(formChip(m, 'LANDSCAPE')?.getAttribute('aria-checked')).toBe('true');
    expect(m.q('[data-testid="inspect-form"] [data-auto]')?.textContent).toBe(p.auto);
    expect(m.q('[data-testid="form-auto"]')).toBeNull();
    click(formChip(m, 'LANDSCAPE'));
    expect(m.onPatch).not.toHaveBeenCalled();
    click(formChip(m, 'PORTRAIT'));
    expect(m.onPatch).toHaveBeenCalledWith({ formOverride: 'PORTRAIT' });
  });

  it('형태: 바꾼 값이면 `자동` 없이 `자동으로 되돌리기`, 자동 값을 고르거나 되돌리기를 누르면 null', () => {
    const a = teacherArtwork(1, 1, { form: 'PORTRAIT', formAuto: 'LANDSCAPE', formOverride: 'PORTRAIT' });
    const m = mount({ artwork: a });
    expect(m.q('[data-testid="inspect-form"] [data-auto]')).toBeNull();
    expect(m.q('[data-testid="form-auto"]')?.textContent).toBe(
      `${p.autoReset} · ${copy.teacher.forms.LANDSCAPE}`,
    );
    click(formChip(m, 'LANDSCAPE'));
    click(m.q('[data-testid="form-auto"]'));
    expect(m.onPatch.mock.calls).toEqual([[{ formOverride: null }], [{ formOverride: null }]]);
  });

  it('형태: 그림 칩이 없는 형태(정사각 등)도 `다른 형태`에서 고른다', () => {
    const m = mount();
    const others = m.qa('[data-testid="inspect-form-other"] [role="radio"]');
    expect(m.q('[data-testid="inspect-form-other"]')?.getAttribute('role')).toBe('radiogroup');
    expect(others.map(b => b.textContent)).toEqual(
      (['SQUARE', 'PANORAMA', 'TALL', 'TEXTCARD', 'MULTIPAGE', 'SOUND'] as const).map(
        f => copy.teacher.forms[f],
      ),
    );
    click(formChip(m, 'SQUARE'));
    expect(m.onPatch).toHaveBeenCalledWith({ formOverride: 'SQUARE' });
  });

  it('형태 칩에서 화살표는 초점만 옮기고 저장하지 않는다', () => {
    const m = mount();
    const from = formChip(m, 'LANDSCAPE');
    act(() => from?.focus());
    key(from, 'ArrowLeft');
    expect(document.activeElement).toBe(formChip(m, 'PORTRAIT'));
    expect(m.onPatch).not.toHaveBeenCalled();
  });

  it('대표작·게시 토글: 누르면 featured·status를 보낸다', () => {
    const m = mount();
    expect(switchNamed(m, p.featured)?.getAttribute('aria-checked')).toBe('false');
    expect(switchNamed(m, p.visible)?.getAttribute('aria-checked')).toBe('true');
    click(switchNamed(m, p.featured));
    click(switchNamed(m, p.visible));
    expect(m.onPatch.mock.calls).toEqual([[{ featured: true }], [{ status: 'HIDDEN' }]]);
  });

  it('숨긴 작품은 게시로 켜고, 실패한 작품은 게시 토글이 잠긴다', () => {
    const hidden = mount({ artwork: teacherArtwork(1, 1, { status: 'HIDDEN' }) });
    click(switchNamed(hidden, p.visible));
    expect(hidden.onPatch).toHaveBeenCalledWith({ status: 'PUBLISHED' });
    act(() => root?.unmount());
    const failedArt = mount({ artwork: teacherArtwork(1, 1, { status: 'FAILED' }) });
    expect(switchNamed(failedArt, p.visible)?.disabled).toBe(true);
  });

  it('배치가 저절로 고른 대표작은 `자동` 표시, 감상 상자 액자는 대표작 테', () => {
    const auto = frameWhere(f => f.featured);
    const m = mount({ artwork: artworkAt(auto.frame, auto.roomId) });
    const featured = switchNamed(m, p.featured);
    const badgeId = featured?.getAttribute('aria-describedby') ?? '';
    expect(badgeId).not.toBe('');
    expect(m.el.querySelector(`[id="${badgeId}"]`)?.textContent).toBe(p.auto);
    expect(m.q('[data-testid="inspect-stage"] [data-frame]')?.getAttribute('data-featured')).toBe('true');
    act(() => root?.unmount());
    const other = frameWhere(f => !f.featured);
    const plain = mount({ artwork: artworkAt(other.frame, other.roomId) });
    expect(switchNamed(plain, p.featured)?.getAttribute('aria-describedby')).toBeNull();
    expect(plain.q('[data-testid="inspect-stage"] [data-frame]')?.getAttribute('data-featured')).toBeNull();
    act(() => root?.unmount());
    // 교사가 정한 대표작은 `자동` 없이 켜져 있다
    const pinned = mount({ artwork: artworkAt(auto.frame, auto.roomId, { featured: true }) });
    expect(switchNamed(pinned, p.featured)?.getAttribute('aria-checked')).toBe('true');
    expect(switchNamed(pinned, p.featured)?.getAttribute('aria-describedby')).toBeNull();
  });

  it('쪽 나눔·글 많음: 한 장으로 보기, 글 많음은 자동과 같아지면 null', () => {
    const m = mount();
    click(switchNamed(m, p.pageSingle));
    click(switchNamed(m, p.textHeavy));
    expect(m.onPatch.mock.calls).toEqual([[{ pageMode: 'SINGLE' }], [{ textHeavyOverride: true }]]);
    act(() => root?.unmount());
    const changed = mount({
      artwork: teacherArtwork(1, 1, {
        pageMode: 'SINGLE',
        textHeavy: true,
        textHeavyAuto: false,
        textHeavyOverride: true,
      }),
    });
    expect(switchNamed(changed, p.textHeavy)?.getAttribute('aria-describedby')).toBeNull();
    click(switchNamed(changed, p.pageSingle));
    click(switchNamed(changed, p.textHeavy));
    expect(changed.onPatch.mock.calls).toEqual([[{ pageMode: 'AUTO' }], [{ textHeavyOverride: null }]]);
  });

  it('소리 작품에는 쪽 나눔·글 많음이 없다', () => {
    const m = mount({ artwork: teacherArtwork(1, 1, { kind: 'AUDIO', image: null }) });
    expect(m.qa('[role="switch"]').map(s => s.getAttribute('aria-label'))).toEqual([p.featured, p.visible]);
  });

  it('고르는 칸 저장이 실패하면 그 묶음 아래 다시 시도, 누르면 같은 것을 다시 보낸다', async () => {
    let fails = 1;
    const onPatch = vi.fn(async (_patch: PatchArtworkInput) => {
      if (fails-- > 0) throw new Error('offline');
    });
    const m = mount({ onPatch });
    click(switchNamed(m, p.featured));
    await flush();
    const retry = m.q('[data-testid="retry-featured"]');
    expect(retry?.textContent).toBe(copy.teacher.manage.retrySave);
    click(retry);
    await flush();
    expect(onPatch.mock.calls).toEqual([[{ featured: true }], [{ featured: true }]]);
    expect(m.q('[data-testid="retry-featured"]')).toBeNull();
  });

  it('제목 자동 저장이 실패하면 칸 옆에 다시 시도, 누르면 다시 보낸다', async () => {
    let fails = 1;
    const onPatch = vi.fn(async (_patch: PatchArtworkInput) => {
      if (fails-- > 0) throw new Error('offline');
    });
    const m = mount({ onPatch });
    expect(m.q<HTMLInputElement>('[data-testid="panel-title"]')?.value).toBe('가상 작품 2-2');
    typeInto(m.q('[data-testid="panel-title"]'), '새 제목');
    await wait(AUTOSAVE_DELAY_MS + 100);
    const retry = m.q('[data-testid="panel-title-retry"]');
    expect(retry?.textContent).toBe(copy.teacher.manage.retrySave);
    expect(m.el.textContent).toContain(copy.teacher.manage.saveFailed);
    click(retry);
    await flush();
    expect(onPatch.mock.calls).toEqual([[{ title: '새 제목' }], [{ title: '새 제목' }]]);
    expect(m.q('[data-testid="panel-title-retry"]')).toBeNull();
  });

  it('작가·설명이 비어 있으면 `더하기`, 누르면 칸이 열리고 초점, 비우면 null로 저장', async () => {
    const m = mount();
    expect(m.q('[data-testid="panel-author"]')).toBeNull();
    expect(m.q('[data-testid="panel-caption"]')).toBeNull();
    expect(m.q('[data-testid="add-author"]')?.textContent).toBe(p.addAuthor);
    click(m.q('[data-testid="add-author"]'));
    const author = m.q<HTMLInputElement>('[data-testid="panel-author"]');
    expect(document.activeElement).toBe(author);
    expect(m.q('[data-testid="add-author"]')).toBeNull();
    typeInto(author, '가상 모둠');
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(m.onPatch).toHaveBeenLastCalledWith({ author: '가상 모둠' });

    click(m.q('[data-testid="add-description"]'));
    expect(m.q('[data-testid="add-description"]')).toBeNull();
    expect(document.activeElement).toBe(m.q('[data-testid="panel-caption"]'));
    typeInto(m.q('[data-testid="panel-description"]'), '가상의 긴 설명');
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(m.onPatch).toHaveBeenLastCalledWith({ description: '가상의 긴 설명' });
    typeInto(m.q('[data-testid="panel-caption"]'), '   ');
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(m.onPatch).toHaveBeenLastCalledWith({ caption: null });
  });

  it('작가·설명이 있으면 처음부터 칸이 보이고 `더하기`가 없다', () => {
    const m = mount({
      artwork: teacherArtwork(1, 1, { author: '가상 작가', caption: '가상 한 줄', description: '가상 설명' }),
    });
    expect(m.q<HTMLInputElement>('[data-testid="panel-author"]')?.value).toBe('가상 작가');
    expect(m.q<HTMLInputElement>('[data-testid="panel-caption"]')?.value).toBe('가상 한 줄');
    expect(m.q<HTMLTextAreaElement>('[data-testid="panel-description"]')?.value).toBe('가상 설명');
    expect(m.q('[data-testid="add-author"]')).toBeNull();
    expect(m.q('[data-testid="add-description"]')).toBeNull();
  });

  it('글 작품: `글 고치기`를 누르면 본문 칸, 고치면 textBody로 저장', async () => {
    const text = teacherArtwork(1, 1, {
      kind: 'TEXT',
      form: 'TEXTCARD',
      formAuto: 'TEXTCARD',
      image: null,
      textBody: '가상의 글',
    });
    const m = mount({ artwork: text });
    expect(m.q('[data-testid="inspect-stage"] [data-frame]')?.textContent).toBe('가상의 글');
    expect(m.q('[data-testid="panel-text"]')).toBeNull();
    click(m.q('[data-testid="edit-text"]'));
    const body = m.q<HTMLTextAreaElement>('[data-testid="panel-text"]');
    expect(body?.value).toBe('가상의 글');
    typeInto(body, '가상의 글을 고침');
    await wait(AUTOSAVE_DELAY_MS + 100);
    expect(m.onPatch).toHaveBeenLastCalledWith({ textBody: '가상의 글을 고침' });
    act(() => root?.unmount());
    expect(mount().q('[data-testid="edit-text"]')).toBeNull();
  });

  it('걸린 자리: 안쪽 벽이면 "0n 전시실 안쪽 벽", 지도 핀이 그 작품', () => {
    const at = frameWhere(f => f.mount === 'WALL' && f.wall === 'F');
    const m = mount({ artwork: artworkAt(at.frame, at.roomId) });
    const no = String(at.r + 1).padStart(2, '0');
    expect(m.q('[data-testid="inspect-hung"]')?.textContent).toBe(fill(p.hungPlace, { no, wall: p.walls.F }));
    expect(m.q('[data-testid="floor-plan-pin"]')?.getAttribute('data-artwork-id')).toBe(at.frame.artworkId);
    expect(m.q(`polygon[data-room-id="${at.roomId}"]`)?.getAttribute('class')).toMatch(/selected/);
  });

  it('걸린 자리: 이젤 작품은 가운데 이젤', () => {
    const at = frameWhere(f => f.mount === 'EASEL');
    const m = mount({ artwork: artworkAt(at.frame, at.roomId) });
    expect(m.q('[data-testid="inspect-hung"]')?.textContent).toBe(
      fill(p.hungPlace, { no: String(at.r + 1).padStart(2, '0'), wall: p.walls.easel }),
    );
  });

  it('걸려 있지 않으면(배치 없음·숨김) 핀 없이 `지금은 걸려 있지 않아요`', () => {
    const none = mount({ layout: null });
    expect(none.q('[data-testid="inspect-hung"]')?.textContent).toBe(p.notHung);
    expect(none.q('[data-testid="floor-plan"]')?.getAttribute('data-state')).toBe('empty');
    act(() => root?.unmount());
    const hidden = mount({ artwork: teacherArtwork(1, 1, { id: '00000000-0000-4000-8000-00000000abcd' }) });
    expect(hidden.q('[data-testid="inspect-hung"]')?.textContent).toBe(p.notHung);
    expect(hidden.q('[data-testid="floor-plan-pin"]')).toBeNull();
  });

  it('3D에서 이 자리 보기·삭제', () => {
    const onPreviewHere = vi.fn();
    const onDelete = vi.fn();
    const m = mount({ onPreviewHere, onDelete });
    click(m.q('[data-testid="inspect-preview"]'));
    click(m.q('[data-testid="panel-delete"]'));
    expect(onPreviewHere).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    const none = mount({ onPreviewHere: null });
    expect(none.q<HTMLButtonElement>('[data-testid="inspect-preview"]')?.disabled).toBe(true);
  });

  it('다른 작품으로 바뀌면 열어 둔 칸을 새 작품 기준으로 다시 정한다', () => {
    const m = mount();
    click(m.q('[data-testid="add-author"]'));
    expect(m.q('[data-testid="panel-author"]')).not.toBeNull();
    act(() => root?.render(<InspectPanel {...m.props} artwork={teacherArtwork(1, 2)} index={2} />));
    expect(m.q('[data-testid="panel-author"]')).toBeNull();
    expect(m.q('[data-testid="artwork-panel"]')?.getAttribute('data-artwork-id')).toBe(
      teacherArtwork(1, 2).id,
    );
  });
});
