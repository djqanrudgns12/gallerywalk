import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { ArtworkForm, ArtworkTeacher, Layout, RoomTeacher } from '@gallery/core/types';
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { PatchArtworkInput } from '../../../ports/index.ts';
import {
  FormChips,
  Frame,
  Icon,
  OrderStepper,
  RoomTiles,
  ToggleTile,
  type FormChipOption,
  type FrameShape,
  type RoomTile,
} from '../../../ui/index.ts';
import { radioKeyStep } from '../../../ui/patterns/radioKeys.ts';
import { isUntitled, thumbOf } from './artworkLook.ts';
import { AutosaveField } from './AutosaveField.tsx';
import { FloorPlan } from './FloorPlan.tsx';
import s from './InspectPanel.module.css';
import m from './manage.module.css';

/** 그림 칩이 있는 형태(세로 액자·가로 액자). 나머지는 `다른 형태` 칩 줄에서 고른다 */
type ChipForm = 'PORTRAIT' | 'LANDSCAPE';
const CHIP_FORMS: readonly FormChipOption<ChipForm>[] = [
  { value: 'PORTRAIT', label: copy.teacher.forms.PORTRAIT, glyph: 'portrait' },
  { value: 'LANDSCAPE', label: copy.teacher.forms.LANDSCAPE, glyph: 'landscape' },
];
const OTHER_FORMS: readonly ArtworkForm[] = ['SQUARE', 'PANORAMA', 'TALL', 'TEXTCARD', 'MULTIPAGE', 'SOUND'];
const isChipForm = (f: ArtworkForm): f is ChipForm => f === 'PORTRAIT' || f === 'LANDSCAPE';

export interface InspectPanelProps {
  readonly exhibitionId: string;
  readonly artwork: ArtworkTeacher;
  /** 보드 차례(번호 01부터) */
  readonly rooms: readonly RoomTeacher[];
  /** 전시실별 보드 작품 수 */
  readonly roomCounts: ReadonlyMap<string, number>;
  /** 그 전시실 안 자리(0부터) */
  readonly index: number;
  readonly count: number;
  /** 걸린 자리 지도 */
  readonly layout: Layout | null;
  readonly onPatch: (patch: PatchArtworkInput) => Promise<void>;
  readonly onNudge: (delta: -1 | 1) => void;
  readonly onMoveRoom: (roomId: string) => void;
  /** null이면 잠금 */
  readonly onPrev: (() => void) | null;
  readonly onNext: (() => void) | null;
  /** 게시 작품이 없으면 null */
  readonly onPreviewHere: (() => void) | null;
  readonly onDelete: () => void;
}

type PatchKey = 'form' | 'pageMode' | 'textHeavy' | 'featured' | 'status';

const roomNo = (i: number): string => (i < 0 ? '' : String(i + 1).padStart(2, '0'));

/**
 * 번호 타일·형태 칩은 라디오 묶음이라 화살표가 바로 고른다. 여기서 고르기는 옮기기·저장 요청이라
 * 화살표·Home·End는 초점만 옮기고, 고르기는 Enter·Space(누르기)로 한다(화살표마다 요청이 가지 않게).
 */
const focusOnly = (e: KeyboardEvent<HTMLDivElement>): void => {
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const at = radios.findIndex(r => r === e.target);
  if (at < 0) return;
  const to = radioKeyStep(e.key, at, radios.length);
  if (to === null) return;
  e.preventDefault();
  e.stopPropagation();
  radios[to]?.focus();
};

/** 감상 상자 액자의 모양: 그림(첫 쪽)이 있으면 실제 비율, 없으면 글은 세로·소리는 정사각 */
const frameLook = (a: ArtworkTeacher): { readonly ratio: number; readonly shape: FrameShape } => {
  const px = a.image ?? a.pages?.[0] ?? null;
  if (px && px.w > 0 && px.h > 0) return { ratio: px.w / px.h, shape: 'landscape' };
  return a.kind === 'AUDIO'
    ? { ratio: 1, shape: 'square' }
    : { ratio: config().MANAGE_PORTRAIT_RATIO, shape: 'portrait' };
};

/**
 * 작품 살펴보기 칸(G-32, FIELD_PLAN §5.4 ④·§5.6 HT-05). 데스크톱 오른쪽 칸(폭 420px). 접힌 칸 없이 위에서 아래로:
 * 감상 상자(액자·이전·다음) → 제목·작가·설명(글 작품은 본문) → 전시실 번호 타일 → 순서·형태 → 대표작·게시(·쪽 나눔·글 많음)
 * → 걸린 자리 지도 → `3D에서 이 자리 보기`·삭제.
 * - 글 칸은 `AutosaveField`(0.6초 뒤 자동 저장, 실패하면 칸 옆에 다시 시도). 고르는 칸은 바로 보내고 실패하면 그 묶음 아래 다시 시도.
 * - 번호 타일은 그 전시실 **끝으로** 옮기고(`onMoveRoom`), 순서 앞뒤는 `onNudge` — 결과는 끌기와 같은 한 번에 놓기 요청이다.
 */
export const InspectPanel = (props: InspectPanelProps) => <InspectBody key={props.artwork.id} {...props} />;

const InspectBody = ({
  exhibitionId,
  artwork: a,
  rooms,
  roomCounts,
  index,
  count,
  layout,
  onPatch,
  onNudge,
  onMoveRoom,
  onPrev,
  onNext,
  onPreviewHere,
  onDelete,
}: InspectPanelProps) => {
  const p = copy.teacher.panel;
  const cfg = config();
  const [showAuthor, setShowAuthor] = useState(a.author !== null);
  const [showDescription, setShowDescription] = useState(a.caption !== null || a.description !== null);
  const [showText, setShowText] = useState(false);
  /** 누르기로 방금 연 칸(그 칸에 바로 초점) */
  const [opened, setOpened] = useState<'author' | 'description' | 'text' | null>(null);
  const [failed, setFailed] = useState<{ readonly key: PatchKey; readonly patch: PatchArtworkInput } | null>(
    null,
  );

  const send = (key: PatchKey, patch: PatchArtworkInput) => {
    setFailed(null);
    onPatch(patch).catch(() => setFailed({ key, patch }));
  };
  const retryFor = (...keys: PatchKey[]): ReactNode =>
    failed !== null && keys.includes(failed.key) ? (
      <button
        type="button"
        className={`${m.retry} ${s.retry}`}
        data-testid={`retry-${failed.key}`}
        onClick={() => send(failed.key, failed.patch)}
      >
        {copy.teacher.manage.retrySave}
      </button>
    ) : null;

  const nullable = (v: string) => (v.trim() === '' ? null : v);
  const busy = a.status === 'PROCESSING';
  const title = isUntitled(a) ? copy.teacher.manage.untitled : a.title;
  const roomAt = rooms.findIndex(r => r.id === a.roomId);
  const roomOrder = useMemo(() => rooms.map(r => r.id), [rooms]);

  const tiles = useMemo<RoomTile[]>(
    () =>
      rooms.map((r, i) => {
        const n = roomCounts.get(r.id) ?? 0;
        return {
          id: r.id,
          no: roomNo(i),
          caption: fill(copy.teacher.manage.roomCount, { n }),
          label: fill(p.roomTile, { no: roomNo(i), name: r.title, n }),
        };
      }),
    [rooms, roomCounts, p.roomTile],
  );

  // 걸린 자리: 저장된 배치(게시 작품만)에서 이 작품의 액자 → 관 → 전시실 번호·논리 벽
  const hung = useMemo(() => {
    const frame = layout?.frames.find(f => f.artworkId === a.id) ?? null;
    if (layout === null || frame === null) return null;
    const roomId = layout.parts.find(part => part.partId === frame.partId)?.roomId ?? null;
    const wall = frame.mount === 'EASEL' || frame.wall === null ? p.walls.easel : p.walls[frame.wall];
    return {
      roomId,
      featured: frame.featured,
      text: fill(p.hungPlace, { no: roomNo(rooms.findIndex(r => r.id === roomId)), wall }),
    };
  }, [layout, a.id, rooms, p]);
  // 대표작을 정하지 않은 전시실에서 배치가 저절로 고른 대표작
  const autoFeatured = !a.featured && hung?.featured === true;

  const look = frameLook(a);
  const stageStyle = { '--ratio': String(look.ratio) } as CSSProperties;

  const pickRoom = (roomId: string) => {
    if (busy || roomId === a.roomId) return;
    onMoveRoom(roomId);
  };
  const pickForm = (f: ArtworkForm) => {
    if (f === a.form) return;
    send('form', { formOverride: f === a.formAuto ? null : f });
  };

  const otherAt = OTHER_FORMS.indexOf(a.form);
  const otherId = useId();

  return (
    <section
      className={s.panel}
      aria-label={p.inspectLabel}
      data-testid="artwork-panel"
      data-artwork-id={a.id}
    >
      {/* ① 감상 상자 */}
      <div className={s.stage} style={stageStyle} data-testid="inspect-stage">
        <button
          type="button"
          className={`${s.nav} ${s.navPrev}`}
          aria-label={p.prev}
          disabled={onPrev === null}
          onClick={() => onPrev?.()}
          data-testid="inspect-prev"
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <Frame
          src={thumbOf(exhibitionId, a)}
          alt={title}
          ratio={look.ratio}
          shape={look.shape}
          featured={a.featured || autoFeatured}
          className={s.viewFrame}
        >
          {a.kind === 'TEXT' ? (
            <span className={s.peek}>{a.textBody}</span>
          ) : a.kind === 'AUDIO' ? (
            <Icon name="sound-on" size={28} />
          ) : null}
        </Frame>
        <button
          type="button"
          className={`${s.nav} ${s.navNext}`}
          aria-label={p.next}
          disabled={onNext === null}
          onClick={() => onNext?.()}
          data-testid="inspect-next"
        >
          <Icon name="chevron-right" size={20} />
        </button>
        <span className={s.where} data-testid="inspect-position">
          {fill(p.position, { no: roomNo(roomAt), n: index + 1 })}
        </span>
      </div>

      {/* ② 글: 제목·작가·한 줄 설명(·긴 설명·글 본문) */}
      <div className={s.words}>
        <AutosaveField
          label={p.title}
          hideLabel
          placeholder={copy.teacher.manage.untitled}
          value={a.title}
          maxChars={cfg.ARTWORK_TITLE_MAX_CHARS}
          onSave={next => onPatch({ title: next })}
          className={s.title}
          testId="panel-title"
        />
        {showAuthor ? (
          <AutosaveField
            label={p.author}
            hideLabel
            placeholder={p.author}
            value={a.author ?? ''}
            maxChars={cfg.AUTHOR_MAX_CHARS}
            autoFocus={opened === 'author'}
            onSave={v => onPatch({ author: nullable(v) })}
            className={s.quiet}
            testId="panel-author"
          />
        ) : null}
        {showDescription ? (
          <>
            <AutosaveField
              label={p.caption}
              hideLabel
              placeholder={p.caption}
              value={a.caption ?? ''}
              maxChars={cfg.CAPTION_MAX_CHARS}
              autoFocus={opened === 'description'}
              onSave={v => onPatch({ caption: nullable(v) })}
              className={s.quiet}
              testId="panel-caption"
            />
            <AutosaveField
              label={p.description}
              value={a.description ?? ''}
              multiline
              maxChars={cfg.DESCRIPTION_MAX_CHARS}
              onSave={v => onPatch({ description: nullable(v) })}
              className={s.long}
              testId="panel-description"
            />
          </>
        ) : null}
        {a.kind === 'TEXT' && showText ? (
          <AutosaveField
            label={p.textBody}
            value={a.textBody ?? ''}
            multiline
            required
            maxChars={cfg.TEXT_MAX_CHARS}
            autoFocus={opened === 'text'}
            onSave={textBody => onPatch({ textBody })}
            className={s.long}
            testId="panel-text"
          />
        ) : null}
        {!showAuthor || !showDescription || (a.kind === 'TEXT' && !showText) ? (
          <div className={s.adds}>
            {showAuthor ? null : (
              <button
                type="button"
                className={s.add}
                data-testid="add-author"
                onClick={() => {
                  setShowAuthor(true);
                  setOpened('author');
                }}
              >
                <Icon name="plus" size={16} />
                {p.addAuthor}
              </button>
            )}
            {showDescription ? null : (
              <button
                type="button"
                className={s.add}
                data-testid="add-description"
                onClick={() => {
                  setShowDescription(true);
                  setOpened('description');
                }}
              >
                <Icon name="plus" size={16} />
                {p.addDescription}
              </button>
            )}
            {a.kind === 'TEXT' && !showText ? (
              <button
                type="button"
                className={s.add}
                data-testid="edit-text"
                onClick={() => {
                  setShowText(true);
                  setOpened('text');
                }}
              >
                <Icon name="plus" size={16} />
                {p.editText}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ③ 전시실 번호 타일: 누르면 그 전시실 끝으로 */}
      <div className={s.block}>
        <p className={s.label}>
          <span>{p.room}</span>
          <b>{rooms[roomAt]?.title ?? ''}</b>
        </p>
        <div onKeyDownCapture={focusOnly} data-testid="inspect-rooms">
          <RoomTiles rooms={tiles} value={a.roomId} onChange={pickRoom} label={p.room} />
        </div>
      </div>

      {/* ④ 순서 · ⑤ 형태 */}
      <div className={s.pair}>
        <div className={s.block}>
          <span className={s.label} aria-hidden="true">
            {p.order}
          </span>
          <OrderStepper
            index={index + 1}
            total={count}
            onPrev={() => onNudge(-1)}
            onNext={() => onNudge(1)}
            prevLabel={p.earlier}
            nextLabel={p.later}
            label={p.order}
            valueText={fill(p.orderValue, { total: count, n: index + 1 })}
          />
        </div>
        <div onKeyDownCapture={focusOnly} data-testid="inspect-form">
          <FormChips
            options={CHIP_FORMS}
            value={isChipForm(a.form) ? a.form : null}
            onChange={pickForm}
            label={p.formShort}
            autoLabel={a.formOverride === null ? p.auto : undefined}
          />
        </div>
      </div>
      <div className={s.others} onKeyDownCapture={focusOnly}>
        <span className={s.label} id={otherId}>
          {p.formOther}
        </span>
        <div
          className={s.otherRow}
          role="radiogroup"
          aria-labelledby={otherId}
          data-testid="inspect-form-other"
        >
          {OTHER_FORMS.map((f, i) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={a.form === f}
              tabIndex={i === Math.max(0, otherAt) ? 0 : -1}
              className={s.other}
              data-value={f}
              onClick={() => pickForm(f)}
            >
              {copy.teacher.forms[f]}
            </button>
          ))}
        </div>
        {a.formOverride === null ? null : (
          <button
            type="button"
            className={s.reset}
            data-testid="form-auto"
            onClick={() => send('form', { formOverride: null })}
          >
            {`${p.autoReset} · ${copy.teacher.forms[a.formAuto]}`}
          </button>
        )}
        {retryFor('form')}
      </div>

      {/* ⑥ 대표작·게시(글·그림 작품은 쪽 나눔·글 많음도) */}
      <div className={s.block}>
        <div className={s.toggles}>
          <ToggleTile
            label={p.featured}
            mark="featured"
            checked={a.featured}
            badge={autoFeatured ? p.auto : undefined}
            disabled={busy}
            onChange={next => send('featured', { featured: next })}
          />
          <ToggleTile
            label={p.visible}
            checked={a.status === 'PUBLISHED'}
            disabled={busy || a.status === 'FAILED'}
            onChange={next => send('status', { status: next ? 'PUBLISHED' : 'HIDDEN' })}
          />
          {a.kind === 'AUDIO' ? null : (
            <>
              <ToggleTile
                label={p.pageSingle}
                checked={a.pageMode === 'SINGLE'}
                onChange={next => send('pageMode', { pageMode: next ? 'SINGLE' : 'AUTO' })}
              />
              <ToggleTile
                label={p.textHeavy}
                checked={a.textHeavy}
                badge={a.textHeavyOverride === null ? p.auto : undefined}
                onChange={next =>
                  send('textHeavy', { textHeavyOverride: next === a.textHeavyAuto ? null : next })
                }
              />
            </>
          )}
        </div>
        {retryFor('featured', 'status', 'pageMode', 'textHeavy')}
      </div>

      {/* ⑦ 걸린 자리 + 작은 지도 */}
      <div className={s.block}>
        <p className={s.label}>
          <span>{p.hungAt}</span>
          <b data-testid="inspect-hung">{hung?.text ?? p.notHung}</b>
        </p>
        <div className={s.map}>
          <FloorPlan
            layout={layout}
            roomOrder={roomOrder}
            width={config().MANAGE_MAP.hung.width}
            height={config().MANAGE_MAP.hung.height}
            mini
            selectedRoomId={hung?.roomId ?? null}
            selectedArtworkId={a.id}
          />
        </div>
      </div>

      {/* ⑧ 아래 줄 */}
      <footer className={s.foot}>
        <button
          type="button"
          className={s.preview}
          disabled={onPreviewHere === null}
          onClick={() => onPreviewHere?.()}
          data-testid="inspect-preview"
          aria-label={p.previewHere}
        >
          <Icon name="eye" size={18} />
          <span className={s.long} aria-hidden="true">
            {p.previewHere}
          </span>
          <span className={s.short} aria-hidden="true">
            {p.previewHereShort}
          </span>
        </button>
        {/* 휴대폰 시트(시안 04): 감상 상자의 앞뒤 단추 대신 아래 줄의 `다음 작품` */}
        <button
          type="button"
          className={s.nextFoot}
          disabled={onNext === null}
          onClick={() => onNext?.()}
          data-testid="inspect-next-foot"
        >
          {p.next}
          <Icon name="chevron-right" size={18} />
        </button>
        <button type="button" className={s.delete} onClick={onDelete} data-testid="panel-delete">
          {p.delete}
        </button>
      </footer>
    </section>
  );
};
