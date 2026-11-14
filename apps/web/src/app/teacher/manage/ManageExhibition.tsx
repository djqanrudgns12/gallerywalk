import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import type { ExhibitionTeacher } from '@gallery/core/types';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ManageFrameSize } from '../../../ports/index.ts';
import { Icon } from '../../../ui/Icon.tsx';
import { Frame, Seg, StatNumber, StatusPill, type FrameSize } from '../../../ui/patterns/teacher/index.ts';
import { useWalk } from '../../../viewer/walk/walkStore.ts';
import { PATHS } from '../../routes.ts';
import { useServices } from '../../services.ts';
import { useArrivalToast } from '../shared/nav.ts';
import { Toast } from '../shared/Toast.tsx';
import {
  DragCover,
  DropZone,
  useFilePickers,
  usePhoneUpload,
  useWindowDrop,
  type FilePickers,
} from '../upload/DropZone.tsx';
import { UploadTray } from '../upload/UploadTray.tsx';
import { useUploads } from '../upload/useUploads.ts';
import { columnsOf, type Arrangement } from './arrange.ts';
import { isUntitled, needsCheck, thumbOf } from './artworkLook.ts';
import { AutosaveField } from './AutosaveField.tsx';
import { BatchBar } from './BatchBar.tsx';
import { ClassTab } from './ClassTab.tsx';
import { parseKey } from './dnd.ts';
import { FloorPlan } from './FloorPlan.tsx';
import { InspectPanel } from './InspectPanel.tsx';
import { ManageDnd, useDragState } from './ManageDnd.tsx';
import { ManageMenu } from './ManageMenu.tsx';
import { OpenSheet } from './OpenSheet.tsx';
import { PasteSheet } from './PasteSheet.tsx';
import { PreloadSheet } from './PreloadSheet.tsx';
import { ReactionsTab } from './ReactionsTab.tsx';
import { RoomBoards } from './RoomBoard.tsx';
import { RoomSheet } from './RoomSheet.tsx';
import { liveArtworks, useTeacherStore, type ManageTab } from './teacherStore.ts';
import { ManageContext, toastMs, useCreateManageActions } from './useManage.ts';
import { isUndoKey } from './undo.ts';
import s from './ManageExhibition.module.css';

const MS_PER_SEC = 1000;
/** 오른쪽 칸 지도 크기(px): 칸 폭 420 − 안쪽 여백 */
const SIDE_MAP = { width: 380, height: 260 } as const;
/** 확인할 것 칩에 겹쳐 보일 작은 그림 수 */
const CHECK_THUMBS = 3;

// 3D 미리 보기(P5-6)는 누를 때 받는다 — 관리 화면 첫 받기에 3D 엔진을 싣지 않게
const PreviewLayer = lazy(() => import('./PreviewLayer.tsx').then(mod => ({ default: mod.PreviewLayer })));

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly code: ErrorCode };

const PILL = { DRAFT: 'draft', OPEN: 'open', CLOSED: 'closed' } as const;

/** 태블릿(터치 + 좁은 화면)에서 `크게`는 72px 액자 */
const TABLET_QUERY = '(pointer: coarse) and (max-width: 1279px)';
const useMedia = (query: string): boolean => {
  const get = () => globalThis.matchMedia?.(query).matches ?? false;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return;
    const change = () => setOn(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, [query]);
  return on;
};

/** 오른쪽 칸 전시 지도: 끄는 작품이 놓일 전시실을 밝힌다 */
const SideMap = ({
  layout,
  roomOrder,
  onPickRoom,
}: {
  readonly layout: Parameters<typeof FloorPlan>[0]['layout'];
  readonly roomOrder: readonly string[];
  readonly onPickRoom: (roomId: string) => void;
}) => {
  const drag = useDragState();
  return (
    <FloorPlan
      layout={layout}
      roomOrder={roomOrder}
      width={SIDE_MAP.width}
      height={SIDE_MAP.height}
      dropRoomId={drag.overRoom}
      onPickRoom={onPickRoom}
    />
  );
};

/**
 * `작품 올리기` 작은 차림표: 파일 고르기 · 폴더 고르기(휴대폰 제외) · 글 붙여넣기. 바깥을 누르거나 Esc면 닫힌다.
 * 작품이 하나도 없으면 큰 놓기 영역이 같은 일을 한다.
 */
const UploadMenu = ({
  pickers,
  onPick,
  onPasteText,
}: {
  readonly pickers: FilePickers;
  readonly onPick: () => void;
  readonly onPasteText: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const phone = usePhoneUpload();
  const u = copy.teacher.upload;
  useEffect(() => {
    if (!open) return;
    const shut = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (!(e instanceof KeyboardEvent) && (e.target as Element | null)?.closest?.('[data-upload-menu]'))
        return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', shut);
    window.addEventListener('keydown', shut);
    return () => {
      window.removeEventListener('pointerdown', shut);
      window.removeEventListener('keydown', shut);
    };
  }, [open]);
  const run = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <span className={s.uploadMenu} data-upload-menu="">
      <button
        type="button"
        className={s.outline}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(o => !o)}
        data-testid="summary-upload"
      >
        <Icon name="plus" />
        {copy.teacher.manage.upload}
      </button>
      {open ? (
        <span className={s.menu} role="menu" data-testid="upload-menu">
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={run(() => {
              onPick();
              pickers.pickFiles();
            })}
          >
            <Icon name="upload" />
            {u.pickFiles}
          </button>
          {phone ? null : (
            <button
              type="button"
              role="menuitem"
              className={s.menuItem}
              onClick={run(() => {
                onPick();
                pickers.pickFolder();
              })}
            >
              <Icon name="grid" />
              {u.pickFolder}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={run(onPasteText)}
            data-testid="paste-open"
          >
            <Icon name="pencil" />
            {u.pasteText}
          </button>
        </span>
      ) : null}
    </span>
  );
};

/**
 * 교사 작업 화면 v3 `/t/e/{id}`(PRD 18장 G-26·G-32, FIELD_PLAN §5.1·§5.4·§5.5, PLAN §7.4).
 * - 위 줄: 뒤로 · 전시 이름(눌러 고침, 22px 명조) · 상태 알약 · 모드 탭 `작품 / 수업 / 반응` · `미리 보기` · 주요 버튼 · `···`.
 * - 작품 탭: 요약 줄(큰 숫자 · 확인할 것 그림 칩 · 크게/작게 · 여러 개 고르기 · 작품 올리기) → 모든 전시실 판(끌어 놓기).
 *   오른쪽 칸(이 화면의 유일한 지도 자리): 고른 작품 살펴보기, 고르지 않았으면 전시 전체 지도.
 * - 바깥 틀에 `data-surface="manage"`(돌 바탕·종이 칸·액자 토큰).
 */
export const ManageExhibition = () => {
  const { id = '' } = useParams();
  const { api, device } = useServices();
  const navigate = useNavigate();
  const actions = useCreateManageActions(api.teacher, id);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const view = useTeacherStore(st => st.view);
  const selected = useTeacherStore(st => st.selected);
  const overlay = useTeacherStore(st => st.overlay);
  const toast = useTeacherStore(st => st.toast);
  const tab = useTeacherStore(st => st.tab);
  const flashId = useTeacherStore(st => st.flashId);
  const st = useTeacherStore.getState;
  const [arrival, clearArrival] = useArrivalToast();
  const [previewing, setPreviewing] = useState(false);
  /** 미리 보기를 이 작품 앞에서 시작(HT-06) */
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  // `···` 메뉴는 자기 덮개(메뉴·확인 시트)를 스스로 연다. 관리 화면의 덮개(패널·시트·열기)를 열면 메뉴를 새로 그려 닫는다
  const [menuEpoch, setMenuEpoch] = useState(0);
  // 글 붙여넣기 시트(V-01)도 덮개 하나: 열 때 관리 화면 덮개를 닫고, 관리 화면 덮개가 열리면 닫힌다
  const [pasting, setPasting] = useState(false);
  const [frameSize, setFrameSize] = useState<ManageFrameSize>(() => device.manageFrameSize());
  const [selectMode, setSelectMode] = useState(false);
  // 수업 탭의 `수업 전 미리 불러오기` 시트(덮개 하나)
  const [preloading, setPreloading] = useState(false);
  const [reactionCount, setReactionCount] = useState(0);
  const tablet = useMedia(TABLET_QUERY);
  useEffect(() => {
    if (overlay !== null) setMenuEpoch(n => n + 1);
    if (overlay !== null) setPasting(false);
    if (overlay !== null) setPreloading(false);
  }, [overlay]);

  const uploads = useUploads(api.teacher, id);
  const start = useCallback(
    (files: Parameters<typeof uploads.start>[0]) => void uploads.start(files),
    [uploads],
  );
  const pickers = useFilePickers(start);
  const dragOver = useWindowDrop(load.kind === 'ready' && tab === 'artworks', start);

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' });
    actions.reload().then(
      () => {
        // 열린 전시는 수업 탭이 먼저(FIELD_PLAN HT-07)
        if (useTeacherStore.getState().view?.exhibition.status === 'OPEN')
          useTeacherStore.getState().setTab('class');
        setLoad({ kind: 'ready' });
      },
      (err: unknown) => setLoad({ kind: 'error', code: err instanceof AppError ? err.code : 'E_SERVER' }),
    );
  }, [actions]);

  useEffect(() => {
    useTeacherStore.getState().reset();
    reload();
    return () => useTeacherStore.getState().reset();
  }, [reload]);

  // 새 전시 만들기에서 넘어온 토스트("30일 동안 열 수 있어요") — 관리 화면의 토스트 칸 하나로
  useEffect(() => {
    if (arrival === null) return;
    useTeacherStore.getState().showToast({ text: arrival, ms: toastMs() });
    clearArrival();
  }, [arrival, clearArrival]);

  // 이 기기의 최근 전시(첫 화면 카드)
  const ex = view?.exhibition ?? null;
  useEffect(() => {
    if (ex) device.rememberExhibition({ exhibitionId: ex.id, title: ex.title, expiresAt: ex.expiresAt });
  }, [device, ex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 편집 되돌리기(HT-08): 미리 보기 중에는 걷기 키와 섞이지 않게 쓰지 않는다
      if (!previewing && isUndoKey(e)) {
        e.preventDefault();
        void actions.undo();
        return;
      }
      if (e.key !== 'Escape') return;
      if (st().overlay !== null) st().setOverlay(null);
      // 미리 보기: 크게 보기·안내 걷기 중이면 그것부터 닫힌다(걷기 키), 그냥 걷는 중이면 미리 보기를 닫는다
      else if (previewing && useWalk.getState().mode === 'free') setPreviewing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st, previewing, actions]);

  // 수업 탭 반응 수 타일: 탭을 열 때 한 번 센다
  useEffect(() => {
    if (tab !== 'class') return;
    const ctrl = new AbortController();
    api.teacher.reactions(id, { signal: ctrl.signal }).then(
      list => setReactionCount(list.length),
      () => undefined,
    );
    return () => ctrl.abort();
  }, [api, id, tab]);

  const live = useMemo(() => liveArtworks(view), [view]);
  const columns = useMemo(() => columnsOf(view), [view]);
  const byId = useMemo(() => new Map(live.map(a => [a.id, a] as const)), [live]);
  const roomOrder = useMemo(() => columns.map(c => c.roomId), [columns]);
  const counts = useMemo(() => new Map(columns.map(c => [c.roomId, c.ids.length] as const)), [columns]);
  /** 보드 읽는 차례(살펴보기 이전·다음) */
  const reading = useMemo(() => columns.flatMap(c => c.ids), [columns]);

  // 끌어 놓기(ADR-032·074): 안내 문구의 이름, 놓은 결과 → 한 번에 놓기, 끄는 동안 손끝을 따라다니는 모양
  const nameOf = useCallback(
    (key: string): string => {
      const k = parseKey(key);
      if (!k || !view) return '';
      if (k.kind !== 'card') return view.rooms.find(r => r.id === k.id)?.title ?? '';
      const a = view.artworks.find(x => x.id === k.id);
      return !a || isUntitled(a) ? copy.teacher.manage.untitled : a.title;
    },
    [view],
  );
  const onArrange = useCallback(
    (a: Arrangement, moved: readonly string[]) => void actions.arrange(a, { moved }),
    [actions],
  );
  const onReorderRooms = useCallback((ids: readonly string[]) => void actions.reorderRooms(ids), [actions]);
  const toggleSelect = useCallback((aid: string) => useTeacherStore.getState().toggleSelect(aid), []);
  const openArtwork = useCallback(
    (aid: string) => useTeacherStore.getState().setOverlay({ kind: 'artwork', id: aid }),
    [],
  );
  const nudge = useCallback((aid: string, delta: -1 | 1) => void actions.nudgeArtwork(aid, delta), [actions]);
  const editRoom = useCallback(
    (rid: string) => useTeacherStore.getState().setOverlay({ kind: 'room', id: rid }),
    [],
  );
  const setUploadRoom = useCallback((rid: string) => useTeacherStore.getState().setRoom(rid), []);

  if (load.kind === 'error' && !view)
    return (
      <section className={s.notice} data-surface="manage" data-testid="teacher-manage" data-state="error">
        <p className={s.noticeText}>{errorCopy[load.code]}</p>
        {load.code === 'E_AUTH' || load.code === 'E_NOT_FOUND' ? (
          <button type="button" className={s.primary} onClick={() => void navigate('/t')}>
            {copy.teacher.manage.goHome}
          </button>
        ) : (
          <button type="button" className={s.primary} onClick={reload}>
            {copy.entry.retry}
          </button>
        )}
      </section>
    );

  if (!view || !ex)
    return (
      <section className={s.notice} data-surface="manage" data-testid="teacher-manage" data-state="loading">
        <p className={s.noticeText}>{copy.teacher.manage.loading}</p>
      </section>
    );

  const m = copy.teacher.manage;
  const published = live.filter(a => a.status === 'PUBLISHED').length;
  const checks = reading.flatMap(aid => {
    const a = byId.get(aid);
    return a && needsCheck(a) ? [a] : [];
  });
  const room = overlay?.kind === 'room' ? (view.rooms.find(r => r.id === overlay.id) ?? null) : null;
  const art = overlay?.kind === 'artwork' ? (byId.get(overlay.id) ?? null) : null;
  const artColumn = art ? (columns.find(c => c.roomId === art.roomId)?.ids ?? []) : [];
  const readAt = art ? reading.indexOf(art.id) : -1;
  const inspectAt = (aid: string | undefined) => () => {
    if (aid !== undefined) st().setOverlay({ kind: 'artwork', id: aid });
  };
  const previewFrom = (aid: string | null) => {
    // 살펴보던 작품이 있으면 그 작품 앞에서 시작(HT-06)
    setPreviewAt(aid);
    close();
    setPreviewing(true);
  };
  const close = () => st().setOverlay(null);
  const selecting = selectMode || selected.length > 0;
  const size: FrameSize = frameSize === 'big' && tablet ? 'tablet' : frameSize;

  const renderOverlay = (key: string, count: number): ReactNode => {
    const k = parseKey(key);
    if (k?.kind === 'board') {
      const i = roomOrder.indexOf(k.id);
      const r = view.rooms.find(x => x.id === k.id);
      return r ? (
        <div className={s.boardOverlay} data-surface="manage">
          <span className={s.boardOverlayNo}>{String(i + 1).padStart(2, '0')}</span>
          {r.title}
        </div>
      ) : null;
    }
    const a = k ? byId.get(k.id) : undefined;
    if (!a) return null;
    return (
      <div
        className={s.dragOverlay}
        data-surface="manage"
        style={{ transform: `scale(${config().MANAGE_DRAG_SCALE})` }}
        data-testid="drag-overlay"
      >
        <Frame
          src={thumbOf(id, a)}
          alt={isUntitled(a) ? m.untitled : a.title}
          size={size}
          featured={a.featured}
        />
        {count > 1 ? <span className={s.dragCount}>{fill(copy.teacher.dnd.group, { n: count })}</span> : null}
      </div>
    );
  };
  const onChanged = (next: ExhibitionTeacher) => st().setExhibition(next);

  const jumpTo = (artworkId: string | undefined) => {
    const target = live.find(a => a.id === artworkId);
    if (!target) return;
    st().setTab('artworks');
    st().flash(target.id);
    st().setOverlay({ kind: 'artwork', id: target.id });
  };

  /** 올릴 전시실: 고른 작품의 전시실, 없으면 마지막 전시실(FIELD_PLAN §5.5 올리기) */
  const aimUpload = () => {
    const target = art?.roomId ?? roomOrder[roomOrder.length - 1];
    if (target) st().setRoom(target);
  };
  const uploadHere = () => {
    aimUpload();
    pickers.pickFiles();
  };
  const openPaste = () => {
    aimUpload();
    close();
    setPasting(true);
  };

  const side =
    art !== null ? (
      <InspectPanel
        key={art.id}
        exhibitionId={id}
        artwork={art}
        rooms={view.rooms}
        roomCounts={counts}
        index={artColumn.indexOf(art.id)}
        count={artColumn.length}
        layout={view.layout}
        onPatch={patch => actions.patchArtwork(art.id, patch)}
        onNudge={delta => void actions.nudgeArtwork(art.id, delta)}
        onMoveRoom={rid => void actions.moveArtworks([art.id], rid)}
        onPrev={readAt > 0 ? inspectAt(reading[readAt - 1]) : null}
        onNext={readAt >= 0 && readAt < reading.length - 1 ? inspectAt(reading[readAt + 1]) : null}
        onPreviewHere={published > 0 ? () => previewFrom(art.id) : null}
        onDelete={() => void actions.deleteArtwork(art.id)}
      />
    ) : room !== null ? (
      <RoomSheet
        key={room.id}
        api={api.teacher}
        actions={actions}
        exhibitionId={id}
        room={room}
        rooms={view.rooms}
        artworkCount={counts.get(room.id) ?? 0}
        onRoomChanged={r => st().upsertRoom(r)}
        onClose={close}
      />
    ) : null;

  const primary =
    live.length === 0 ? (
      <button type="button" className={s.primary} onClick={uploadHere} data-testid="primary-upload">
        {m.upload}
      </button>
    ) : (
      <span className={s.primaryWrap}>
        <button
          type="button"
          className={s.primary}
          disabled={published === 0}
          onClick={() => st().setOverlay({ kind: 'open' })}
          data-testid="primary-open"
        >
          {/* 열린 뒤에는 같은 시트가 QR·주소를 보여 준다(PRD 9.4 "전시 열림" 줄) */}
          {ex.status === 'OPEN' ? copy.teacher.menu.showQr : m.open}
        </button>
        {published === 0 ? <span className={s.hint}>{errorCopy.E_NOTHING_PUBLISHED}</span> : null}
      </span>
    );
  const pickInPreview = (aid: string) => {
    if (!byId.has(aid)) return;
    st().setTab('artworks');
    st().setOverlay({ kind: 'artwork', id: aid });
  };
  const tabs: readonly { key: ManageTab; label: string; count?: number }[] = [
    { key: 'artworks', label: m.tabArtworks, count: live.length },
    { key: 'class', label: m.tabClass },
    { key: 'reactions', label: m.tabReactions },
  ];

  return (
    <ManageContext value={actions}>
      <ManageDnd
        columns={columns}
        selected={selected}
        nameOf={nameOf}
        onArrange={onArrange}
        onReorderRooms={onReorderRooms}
        onToggleSelect={toggleSelect}
        renderOverlay={renderOverlay}
      >
        <section
          className={previewing ? `${s.page} ${s.previewing}` : s.page}
          data-surface="manage"
          data-testid="teacher-manage"
          data-state="ready"
        >
          {pickers.inputs}
          <header className={s.top}>
            <button
              type="button"
              className={s.back}
              onClick={() => void navigate('/t')}
              aria-label={m.goHome}
              data-testid="go-home"
            >
              <Icon name="chevron-left" />
            </button>
            <AutosaveField
              key={`ex-title-${ex.id}`}
              label={m.titleLabel}
              hideLabel
              required
              value={ex.title}
              maxChars={config().EXHIBITION_TITLE_MAX_CHARS}
              onSave={title => actions.renameExhibition(title)}
              className={s.exTitle}
              testId="exhibition-title"
            />
            <span data-testid="exhibition-status" data-status={ex.status}>
              <StatusPill
                status={PILL[ex.status]}
                label={copy.teacher.exhibitionStatus[ex.status]}
                onClick={live.length > 0 ? () => st().setOverlay({ kind: 'open' }) : undefined}
                expanded={overlay?.kind === 'open'}
              />
            </span>
            <nav className={s.tabs} role="tablist" aria-label={m.tabsLabel}>
              {tabs.map(t => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? `${s.tab} ${s.tabOn}` : s.tab}
                  onClick={() => st().setTab(t.key)}
                  data-testid={`tab-${t.key}`}
                >
                  {t.label}
                  {t.count !== undefined ? <span className={s.tabCount}>{t.count}</span> : null}
                </button>
              ))}
            </nav>
            <span className={s.topActions}>
              {published > 0 ? (
                <button
                  type="button"
                  className={s.quiet}
                  onClick={() => previewFrom(art?.id ?? null)}
                  data-testid="open-preview"
                >
                  <Icon name="eye" />
                  {m.preview}
                </button>
              ) : null}
              {primary}
              {/* `···` 메뉴의 시트와 패널이 함께 열리지 않게(덮개 하나) 메뉴를 누르면 패널을 닫는다 */}
              <span className={s.menuSlot} onClickCapture={() => overlay?.kind !== 'open' && close()}>
                <ManageMenu
                  key={menuEpoch}
                  exhibition={ex}
                  onChanged={onChanged}
                  onDeleted={() => void navigate('/t')}
                  onOpenSheet={() => st().setOverlay({ kind: 'open' })}
                />
              </span>
            </span>
          </header>

          {tab === 'artworks' ? (
            <div className={s.body}>
              <div className={s.main}>
                <div className={s.summary} data-testid="summary">
                  <StatNumber value={live.length} label={m.statArtworks} />
                  <span className={s.divider} aria-hidden="true" />
                  <StatNumber value={view.rooms.length} label={m.statRooms} />
                  {checks.length > 0 ? (
                    <button
                      type="button"
                      className={s.checkChip}
                      onClick={() => jumpTo(checks[0]?.id)}
                      data-testid="check-chip"
                    >
                      <span className={s.checkThumbs} aria-hidden="true">
                        {checks.slice(0, CHECK_THUMBS).map(a => (
                          <Frame key={a.id} src={thumbOf(id, a)} alt="" size="small" />
                        ))}
                      </span>
                      <span className={s.checkNo}>{checks.length}</span>
                      {m.checkCount}
                    </button>
                  ) : null}
                  <span className={s.spacer} />
                  <Seg
                    label={m.sizeLabel}
                    value={frameSize}
                    options={[
                      { value: 'big', label: m.sizeBig },
                      { value: 'small', label: m.sizeSmall },
                    ]}
                    onChange={next => {
                      setFrameSize(next);
                      device.setManageFrameSize(next);
                    }}
                  />
                  <button
                    type="button"
                    className={selecting ? `${s.quiet} ${s.quietOn}` : s.quiet}
                    aria-pressed={selecting}
                    onClick={() => {
                      if (selecting) {
                        setSelectMode(false);
                        st().clearSelection();
                      } else setSelectMode(true);
                    }}
                    data-testid="select-many"
                  >
                    {m.selectMany}
                  </button>
                  <UploadMenu pickers={pickers} onPick={aimUpload} onPasteText={openPaste} />
                </div>
                {live.length === 0 ? <DropZone empty pickers={pickers} onPasteText={openPaste} /> : null}
                <UploadTray tasks={uploads.tasks} onClear={uploads.clearFinished} artworks={live} />
                <RoomBoards
                  exhibitionId={id}
                  rooms={view.rooms}
                  artworks={byId}
                  size={size}
                  inspectedId={art?.id ?? null}
                  selected={selected}
                  selecting={selecting}
                  flashId={flashId}
                  onOpen={openArtwork}
                  onToggleSelect={toggleSelect}
                  onNudge={nudge}
                  onEditRoom={editRoom}
                  onDropTarget={setUploadRoom}
                  onAddRoom={() =>
                    void actions.createRoom().then(rid => {
                      if (rid) st().setOverlay({ kind: 'room', id: rid });
                    })
                  }
                />
              </div>
              <aside
                className={side ? `${s.side} ${s.sideOpen}` : s.side}
                aria-label={m.sideLabel}
                data-testid="manage-side"
              >
                {side ?? (
                  <div className={s.sideMap}>
                    <h2 className={s.sideTitle}>{m.mapLabel}</h2>
                    <SideMap
                      layout={view.layout}
                      roomOrder={roomOrder}
                      onPickRoom={rid => {
                        const first = columns.find(c => c.roomId === rid)?.ids[0];
                        if (first) st().flash(first);
                      }}
                    />
                    <p className={s.sideHint}>{m.sideHint}</p>
                  </div>
                )}
              </aside>
              {side ? (
                <div className={s.scrim} onClick={close} aria-hidden="true" data-testid="side-scrim" />
              ) : null}
            </div>
          ) : tab === 'class' ? (
            <div className={s.tabBody}>
              <ClassTab
                exhibition={ex}
                layout={view.layout}
                roomOrder={roomOrder}
                reactionCount={reactionCount}
                showBubbles={false}
                onShowQr={() => st().setOverlay({ kind: 'open' })}
                onStartTour={() => void navigate(`/t/e/${id}/tour`)}
                onOpenReactions={() => st().setTab('reactions')}
                onCheckNetwork={() => globalThis.open?.(PATHS.check, '_blank', 'noopener')}
                onPreload={() => {
                  close();
                  setPreloading(true);
                }}
                onOpen={() => st().setOverlay({ kind: 'open' })}
                onCloseExhibition={() =>
                  void api.teacher.changeStatus(id, 'close').then(
                    next => {
                      onChanged(next);
                      st().showToast({ text: copy.teacher.menu.closed, ms: toastMs() });
                    },
                    (err: unknown) => actions.fail(err),
                  )
                }
              />
            </div>
          ) : (
            <div className={s.tabBody}>
              <ReactionsTab exhibitionId={id} artworks={live} />
            </div>
          )}

          {tab === 'artworks' ? (
            <BatchBar
              selected={selected}
              rooms={view.rooms}
              currentRoomId={null}
              onBatch={b => void actions.batch(b)}
              onClear={() => {
                setSelectMode(false);
                st().clearSelection();
              }}
            />
          ) : null}

          {overlay?.kind === 'open' ? (
            <OpenSheet exhibition={ex} publishedCount={published} onChanged={onChanged} onClose={close} />
          ) : null}

          {preloading ? <PreloadSheet exhibitionId={id} onClose={() => setPreloading(false)} /> : null}

          {pasting ? (
            <PasteSheet
              onClose={() => setPasting(false)}
              onSave={(title, body) => {
                setPasting(false);
                void uploads.startText(title, body);
              }}
            />
          ) : null}

          {previewing ? (
            <Suspense fallback={null}>
              <PreviewLayer
                exhibitionId={id}
                revision={view}
                onPick={pickInPreview}
                startArtworkId={previewAt}
                onClose={() => {
                  close();
                  setPreviewing(false);
                }}
              />
            </Suspense>
          ) : null}

          {dragOver ? <DragCover /> : null}
          {toast ? (
            <Toast
              key={toast.id}
              message={toast.text}
              seconds={toast.ms / MS_PER_SEC}
              action={toast.action ? { label: toast.action.label, onClick: toast.action.run } : undefined}
              onDone={() => st().hideToast(toast.id)}
            />
          ) : null}
        </section>
      </ManageDnd>
    </ManageContext>
  );
};
