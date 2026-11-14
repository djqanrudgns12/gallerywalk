import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import type { ExhibitionTeacher } from '@gallery/core/types';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useWalk } from '../../../viewer/walk/walkStore.ts';
import { useServices } from '../../services.ts';
import { useArrivalToast } from '../shared/nav.ts';
import { Toast } from '../shared/Toast.tsx';
import { DragCover, DropZone, useFilePickers, useWindowDrop } from '../upload/DropZone.tsx';
import { UploadTray } from '../upload/UploadTray.tsx';
import { useUploads } from '../upload/useUploads.ts';
import { Icon } from '../../../ui/Icon.tsx';
import { ArtworkBoard, CardFace, isBlurry, isUntitled } from './ArtworkBoard.tsx';
import { ArtworkPanel } from './ArtworkPanel.tsx';
import { AutosaveField } from './AutosaveField.tsx';
import { BatchBar } from './BatchBar.tsx';
import { parseKey, type DropIntent } from './dnd.ts';
import { ManageDnd } from './ManageDnd.tsx';
import { ManageMenu } from './ManageMenu.tsx';
import { OpenSheet } from './OpenSheet.tsx';
import { PasteSheet } from './PasteSheet.tsx';
import { ReactionsTab } from './ReactionsTab.tsx';
import { ChipFace, RoomChips } from './RoomChips.tsx';
import { RoomSheet } from './RoomSheet.tsx';
import { liveArtworks, roomArtworks, useTeacherStore } from './teacherStore.ts';
import { ManageContext, toastMs, useCreateManageActions } from './useManage.ts';
import s from './manage.module.css';

const MS_PER_SEC = 1000;

// 3D 미리 보기(P5-6)는 누를 때 받는다 — 관리 화면 첫 받기에 3D 엔진을 싣지 않게
const PreviewLayer = lazy(() => import('./PreviewLayer.tsx').then(mod => ({ default: mod.PreviewLayer })));

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly code: ErrorCode };

const formatDay = (epochMs: number): string =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(epochMs);

/**
 * 전시 관리 `/t/e/{id}`(PLAN §7.4 G-10~G-13, P5-3·4·5).
 * 위: 전시 이름(눌러서 고침) · 상태 점 · "{날짜}에 지워져요" · `···` · 전시실 칩 줄. 점검 줄 · 탭(작품/반응).
 * 작품 탭: 놓기 영역(빈 상태는 크게) · 올리는 중 목록 · 격자 · 여러 장 띠. 오른쪽(1280↑) 작품 패널·전시실 시트.
 * `미리 보기`(게시 작품이 있을 때): 학생 화면과 같은 3D 전체 화면, 작품을 누르면 그 작품 패널(서랍으로 위에, ADR-057 —
 * 오른쪽 미리 보기 칸은 두지 않는다).
 * 주요 버튼: 작품이 없으면 `작품 올리기`, 게시 작품이 있으면 `전시 열기`(없으면 잠김 + 안내).
 */
export const ManageExhibition = () => {
  const { id = '' } = useParams();
  const { api, device } = useServices();
  const navigate = useNavigate();
  const actions = useCreateManageActions(api.teacher, id);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const view = useTeacherStore(st => st.view);
  const roomId = useTeacherStore(st => st.roomId);
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
  useEffect(() => {
    if (overlay !== null) setMenuEpoch(n => n + 1);
    if (overlay !== null) setPasting(false);
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
      () => setLoad({ kind: 'ready' }),
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
      if (e.key !== 'Escape') return;
      if (st().overlay !== null) st().setOverlay(null);
      // 미리 보기: 크게 보기·안내 걷기 중이면 그것부터 닫힌다(걷기 키), 그냥 걷는 중이면 미리 보기를 닫는다
      else if (previewing && useWalk.getState().mode === 'free') setPreviewing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st, previewing]);

  const live = useMemo(() => liveArtworks(view), [view]);
  const inRoom = useMemo(() => roomArtworks(view, roomId), [view, roomId]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of live) m.set(a.roomId, (m.get(a.roomId) ?? 0) + 1);
    return m;
  }, [live]);

  // 끌어 옮기기(ADR-032): 안내 문구의 이름, 놓은 결과 → 서버 일, 끄는 동안 손끝을 따라다니는 모양
  const nameOf = useCallback(
    (key: string): string => {
      const k = parseKey(key);
      if (!k || !view) return '';
      if (k.kind === 'chip') return view.rooms.find(r => r.id === k.id)?.title ?? '';
      const a = view.artworks.find(x => x.id === k.id);
      return !a || isUntitled(a) ? copy.teacher.manage.untitled : a.title;
    },
    [view],
  );
  const onDrop = useCallback(
    (intent: DropIntent) => {
      switch (intent.kind) {
        case 'reorderArtworks':
          void actions.reorderArtworks(intent.roomId, intent.ids);
          return;
        case 'moveToRoom':
          void actions.moveArtworks(intent.ids, intent.roomId);
          return;
        case 'reorderRooms':
          void actions.reorderRooms(intent.ids);
          return;
        case 'toggleSelect':
          useTeacherStore.getState().toggleSelect(intent.id);
      }
    },
    [actions],
  );

  if (load.kind === 'error' && !view)
    return (
      <section className={s.notice} data-testid="teacher-manage" data-state="error">
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
      <section className={s.notice} data-testid="teacher-manage" data-state="loading">
        <p className={s.noticeText}>{copy.teacher.manage.loading}</p>
      </section>
    );

  const m = copy.teacher.manage;
  const published = live.filter(a => a.status === 'PUBLISHED').length;
  const untitled = live.filter(isUntitled);
  const blurry = live.filter(isBlurry);
  const room = overlay?.kind === 'room' ? (view.rooms.find(r => r.id === overlay.id) ?? null) : null;
  const art = overlay?.kind === 'artwork' ? (live.find(a => a.id === overlay.id) ?? null) : null;
  const artRoom = art ? roomArtworks(view, art.roomId) : [];
  const close = () => st().setOverlay(null);
  const renderOverlay = (key: string) => {
    const k = parseKey(key);
    if (k?.kind === 'chip') {
      const r = view.rooms.find(x => x.id === k.id);
      return r ? (
        <span className={`${s.chip} ${s.dragOverlay}`}>
          <ChipFace title={r.title} count={counts.get(r.id) ?? 0} current={r.id === roomId} />
        </span>
      ) : null;
    }
    const a = k ? live.find(x => x.id === k.id) : undefined;
    if (!a) return null;
    const many = selected.includes(a.id) && selected.length > 1;
    return (
      <div className={s.dragOverlay} data-testid="drag-overlay">
        <CardFace exhibitionId={id} artwork={a} selected={many} dragging={false} />
        {many ? (
          <span className={s.dragCount}>{fill(copy.teacher.selectedCount, { n: selected.length })}</span>
        ) : null}
      </div>
    );
  };
  const onChanged = (next: ExhibitionTeacher) => st().setExhibition(next);

  const jumpTo = (artworkId: string | undefined) => {
    const target = live.find(a => a.id === artworkId);
    if (!target) return;
    st().setTab('artworks');
    st().setRoom(target.roomId);
    st().flash(target.id);
  };

  const side =
    art !== null ? (
      <ArtworkPanel
        key={art.id}
        artwork={art}
        rooms={view.rooms}
        index={artRoom.findIndex(a => a.id === art.id)}
        count={artRoom.length}
        onPatch={patch => actions.patchArtwork(art.id, patch)}
        onNudge={delta => void actions.nudgeArtwork(art.id, delta)}
        onDelete={() => void actions.deleteArtwork(art.id)}
        onClose={close}
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
      <button type="button" className={s.primary} onClick={pickers.pickFiles} data-testid="primary-upload">
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
    const a = live.find(x => x.id === aid);
    if (!a) return;
    st().setTab('artworks');
    st().setRoom(a.roomId);
    st().setOverlay({ kind: 'artwork', id: aid });
  };

  return (
    <ManageContext value={actions}>
      <ManageDnd
        roomId={roomId}
        artworkIds={inRoom.map(a => a.id)}
        roomIds={view.rooms.map(r => r.id)}
        selected={selected}
        nameOf={nameOf}
        onDrop={onDrop}
        renderOverlay={renderOverlay}
      >
        <section
          className={previewing ? `${s.page} ${s.previewing}` : s.page}
          data-testid="teacher-manage"
          data-state="ready"
        >
          {pickers.inputs}
          <header className={s.top}>
            <div className={s.topRow}>
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
              <span className={s.status} data-status={ex.status} data-testid="exhibition-status">
                <span className={s.statusDot} aria-hidden="true" />
                {copy.teacher.exhibitionStatus[ex.status]}
              </span>
              <span className={s.expires}>{fill(m.deletesOn, { date: formatDay(ex.expiresAt) })}</span>
              <span className={s.spacer} />
              {published > 0 ? (
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => {
                    // 작품 패널이 열려 있었으면 그 작품 앞에서 시작(HT-06)
                    setPreviewAt(art?.id ?? null);
                    close();
                    setPreviewing(true);
                  }}
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
            </div>
            <RoomChips
              rooms={view.rooms}
              currentId={roomId}
              counts={counts}
              onPick={rid => st().setRoom(rid)}
              onEdit={rid => st().setOverlay({ kind: 'room', id: rid })}
              onReorder={ids => void actions.reorderRooms(ids)}
              onAdd={() =>
                void actions.createRoom().then(rid => {
                  if (rid) st().setOverlay({ kind: 'room', id: rid });
                })
              }
            />
          </header>

          {untitled.length > 0 || blurry.length > 0 ? (
            <p className={s.checkLine} data-testid="check-line">
              {untitled.length > 0 ? (
                <button type="button" className={s.checkItem} onClick={() => jumpTo(untitled[0]?.id)}>
                  {fill(m.checkUntitled, { n: untitled.length })}
                </button>
              ) : null}
              {untitled.length > 0 && blurry.length > 0 ? <span aria-hidden="true">·</span> : null}
              {blurry.length > 0 ? (
                <button type="button" className={s.checkItem} onClick={() => jumpTo(blurry[0]?.id)}>
                  {fill(m.checkBlurry, { n: blurry.length })}
                </button>
              ) : null}
            </p>
          ) : null}

          <div className={s.tabs} role="tablist" aria-label={m.tabsLabel}>
            {(['artworks', 'reactions'] as const).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? `${s.tab} ${s.tabOn}` : s.tab}
                onClick={() => st().setTab(t)}
                data-testid={`tab-${t}`}
              >
                {t === 'artworks' ? m.tabArtworks : m.tabReactions}
              </button>
            ))}
          </div>

          <div className={s.body}>
            <div className={s.main}>
              {tab === 'artworks' ? (
                <>
                  <DropZone
                    empty={live.length === 0}
                    pickers={pickers}
                    onPasteText={() => {
                      close();
                      setPasting(true);
                    }}
                  />
                  <UploadTray tasks={uploads.tasks} onClear={uploads.clearFinished} artworks={live} />
                  {live.length > 0 ? (
                    <ArtworkBoard
                      exhibitionId={id}
                      artworks={inRoom}
                      selected={selected}
                      flashId={flashId}
                      onOpen={aid => st().setOverlay({ kind: 'artwork', id: aid })}
                      onToggleSelect={aid => st().toggleSelect(aid)}
                      onRename={(aid, title) => actions.patchArtwork(aid, { title })}
                      onNudge={(aid, delta) => void actions.nudgeArtwork(aid, delta)}
                    />
                  ) : null}
                </>
              ) : (
                <ReactionsTab exhibitionId={id} artworks={live} />
              )}
            </div>
            <aside
              className={side ? `${s.side} ${s.sideOpen}` : s.side}
              aria-label={m.sideLabel}
              data-testid="manage-side"
            >
              {side ?? (tab === 'artworks' ? <p className={s.sideHint}>{m.sideHint}</p> : null)}
            </aside>
            {side ? (
              <div className={s.scrim} onClick={close} aria-hidden="true" data-testid="side-scrim" />
            ) : null}
          </div>

          {tab === 'artworks' ? (
            <BatchBar
              selected={selected}
              rooms={view.rooms}
              currentRoomId={roomId}
              onBatch={b => void actions.batch(b)}
              onClear={() => st().clearSelection()}
            />
          ) : null}

          {overlay?.kind === 'open' ? (
            <OpenSheet exhibition={ex} publishedCount={published} onChanged={onChanged} onClose={close} />
          ) : null}

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
