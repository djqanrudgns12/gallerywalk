import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import type { ArtworkForm, ArtworkTeacher, RoomTeacher } from '@gallery/core/types';
import { useState } from 'react';
import { Icon } from '../../../ui/index.ts';
import type { PatchArtworkInput } from '../../../ports/index.ts';
import { AutosaveField } from './AutosaveField.tsx';
import { isUntitled } from './artworkLook.ts';
import s from './manage.module.css';

const FORMS: readonly ArtworkForm[] = [
  'LANDSCAPE',
  'PORTRAIT',
  'SQUARE',
  'PANORAMA',
  'TALL',
  'TEXTCARD',
  'MULTIPAGE',
  'SOUND',
];

export interface ArtworkPanelProps {
  readonly artwork: ArtworkTeacher;
  readonly rooms: readonly RoomTeacher[];
  /** 이 전시실 안에서 몇 번째·몇 개 중(앞으로·뒤로 잠금) */
  readonly index: number;
  readonly count: number;
  readonly onPatch: (patch: PatchArtworkInput) => Promise<void>;
  readonly onNudge: (delta: number) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

type ToggleKey = 'room' | 'form' | 'pageMode' | 'textHeavy' | 'featured' | 'status';

/**
 * 작품 패널(G-11, P5-5). 데스크톱(1280↑)은 오른쪽 칸, 그 아래는 덮개(태블릿 오른쪽 서랍·휴대폰 아래 시트).
 * - 항상: 제목. 접힘: `작가 더하기`·`설명 더하기`(한 줄 + 긴 설명), 글 작품은 `글 고치기`(5,000자).
 * - `자동으로 정한 것`을 펼칠 때만: 전시실·형태·쪽 나눔·글 많음·대표작.
 * - 글 칸은 0.6초 뒤 자동 저장, 실패하면 칸 옆에 다시 시도. 고르는 칸은 바로 보내고, 실패하면 그 줄 옆에 다시 시도.
 */
export const ArtworkPanel = ({
  artwork: a,
  rooms,
  index,
  count,
  onPatch,
  onNudge,
  onDelete,
  onClose,
}: ArtworkPanelProps) => {
  const p = copy.teacher.panel;
  const cfg = config();
  const [showAuthor, setShowAuthor] = useState(a.author !== null);
  const [showDescription, setShowDescription] = useState(a.caption !== null || a.description !== null);
  const [showText, setShowText] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [failed, setFailed] = useState<{ key: ToggleKey; patch: PatchArtworkInput } | null>(null);

  const send = (key: ToggleKey, patch: PatchArtworkInput) => {
    setFailed(null);
    onPatch(patch).catch(() => setFailed({ key, patch }));
  };
  const retryFor = (key: ToggleKey) =>
    failed?.key === key ? (
      <button
        type="button"
        className={s.retry}
        data-testid={`retry-${key}`}
        onClick={() => send(failed.key, failed.patch)}
      >
        {copy.teacher.manage.retrySave}
      </button>
    ) : null;

  const nullable = (v: string) => (v.trim() === '' ? null : v);
  const busy = a.status === 'PROCESSING';

  return (
    <div className={s.panelBody} data-testid="artwork-panel" data-artwork-id={a.id}>
      <header className={s.panelHead}>
        <h2 className={s.panelTitle}>{isUntitled(a) ? copy.teacher.manage.untitled : a.title}</h2>
        <button type="button" className={s.iconBtn} aria-label={p.close} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <AutosaveField
        key={`title-${a.id}`}
        label={p.title}
        value={a.title}
        maxChars={cfg.ARTWORK_TITLE_MAX_CHARS}
        onSave={title => onPatch({ title })}
        testId="panel-title"
      />

      {showAuthor ? (
        <AutosaveField
          key={`author-${a.id}`}
          label={p.author}
          value={a.author ?? ''}
          maxChars={cfg.AUTHOR_MAX_CHARS}
          onSave={v => onPatch({ author: nullable(v) })}
          testId="panel-author"
        />
      ) : (
        <button type="button" className={s.more} onClick={() => setShowAuthor(true)}>
          <Icon name="plus" size={16} />
          {p.addAuthor}
        </button>
      )}

      {showDescription ? (
        <>
          <AutosaveField
            key={`caption-${a.id}`}
            label={p.caption}
            value={a.caption ?? ''}
            maxChars={cfg.CAPTION_MAX_CHARS}
            onSave={v => onPatch({ caption: nullable(v) })}
            testId="panel-caption"
          />
          <AutosaveField
            key={`description-${a.id}`}
            label={p.description}
            value={a.description ?? ''}
            multiline
            maxChars={cfg.DESCRIPTION_MAX_CHARS}
            onSave={v => onPatch({ description: nullable(v) })}
            testId="panel-description"
          />
        </>
      ) : (
        <button type="button" className={s.more} onClick={() => setShowDescription(true)}>
          <Icon name="plus" size={16} />
          {p.addDescription}
        </button>
      )}

      {a.kind === 'TEXT' ? (
        showText ? (
          <AutosaveField
            key={`text-${a.id}`}
            label={p.textBody}
            value={a.textBody ?? ''}
            multiline
            required
            maxChars={cfg.TEXT_MAX_CHARS}
            onSave={textBody => onPatch({ textBody })}
            testId="panel-text"
          />
        ) : (
          <button type="button" className={s.more} onClick={() => setShowText(true)}>
            <Icon name="plus" size={16} />
            {p.editText}
          </button>
        )
      ) : null}

      <div className={s.panelRow}>
        <span className={s.fieldLabel}>{p.order}</span>
        <span className={s.btnRow}>
          <button
            type="button"
            className={s.btn}
            disabled={index <= 0}
            onClick={() => onNudge(-1)}
            data-testid="nudge-earlier"
          >
            <Icon name="chevron-left" size={16} />
            {p.earlier}
          </button>
          <button
            type="button"
            className={s.btn}
            disabled={index >= count - 1}
            onClick={() => onNudge(1)}
            data-testid="nudge-later"
          >
            {p.later}
            <Icon name="chevron-right" size={16} />
          </button>
        </span>
      </div>

      <button
        type="button"
        className={s.more}
        aria-expanded={showAuto}
        onClick={() => setShowAuto(v => !v)}
        data-testid="panel-auto-toggle"
      >
        <Icon name={showAuto ? 'chevron-left' : 'chevron-right'} size={16} />
        {p.autoValues}
      </button>

      {showAuto ? (
        <div className={s.autoBox} data-testid="panel-auto">
          <fieldset className={s.choice}>
            <legend className={s.fieldLabel}>{p.room}</legend>
            <span className={s.choiceRow}>
              {rooms.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className={r.id === a.roomId ? `${s.option} ${s.optionOn}` : s.option}
                  aria-pressed={r.id === a.roomId}
                  disabled={busy}
                  onClick={() => r.id !== a.roomId && send('room', { roomId: r.id })}
                >
                  {r.title}
                </button>
              ))}
              {retryFor('room')}
            </span>
          </fieldset>

          <fieldset className={s.choice}>
            <legend className={s.fieldLabel}>{p.form}</legend>
            <span className={s.choiceRow}>
              <button
                type="button"
                className={a.formOverride === null ? `${s.option} ${s.optionOn}` : s.option}
                aria-pressed={a.formOverride === null}
                onClick={() => send('form', { formOverride: null })}
              >
                {`${p.auto} · ${copy.teacher.forms[a.formAuto]}`}
              </button>
              {FORMS.filter(f => f !== a.formAuto).map(f => (
                <button
                  key={f}
                  type="button"
                  className={a.formOverride === f ? `${s.option} ${s.optionOn}` : s.option}
                  aria-pressed={a.formOverride === f}
                  onClick={() => send('form', { formOverride: f })}
                >
                  {copy.teacher.forms[f]}
                </button>
              ))}
              {retryFor('form')}
            </span>
          </fieldset>

          <fieldset className={s.choice}>
            <legend className={s.fieldLabel}>{p.pageMode}</legend>
            <span className={s.choiceRow}>
              {(['AUTO', 'SINGLE'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  className={a.pageMode === m ? `${s.option} ${s.optionOn}` : s.option}
                  aria-pressed={a.pageMode === m}
                  onClick={() => a.pageMode !== m && send('pageMode', { pageMode: m })}
                >
                  {m === 'AUTO' ? p.auto : p.pageSingle}
                </button>
              ))}
              {retryFor('pageMode')}
            </span>
          </fieldset>

          <label className={s.check}>
            <input
              type="checkbox"
              checked={a.textHeavy}
              onChange={e => send('textHeavy', { textHeavyOverride: e.target.checked })}
            />
            <span>{p.textHeavy}</span>
            {retryFor('textHeavy')}
          </label>

          <label className={s.check}>
            <input
              type="checkbox"
              checked={a.featured}
              disabled={busy}
              onChange={e => send('featured', { featured: e.target.checked })}
            />
            <span>{p.featured}</span>
            {retryFor('featured')}
          </label>
        </div>
      ) : null}

      <footer className={s.panelFoot}>
        <button
          type="button"
          className={s.btn}
          disabled={busy || a.status === 'FAILED'}
          data-testid="panel-visibility"
          onClick={() => send('status', { status: a.status === 'HIDDEN' ? 'PUBLISHED' : 'HIDDEN' })}
        >
          {a.status === 'HIDDEN' ? p.publish : p.hide}
        </button>
        {retryFor('status')}
        <button
          type="button"
          className={`${s.btn} ${s.btnDanger}`}
          onClick={onDelete}
          data-testid="panel-delete"
        >
          {p.delete}
        </button>
      </footer>
    </div>
  );
};
