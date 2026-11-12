import { copy } from '@gallery/core/copy';
import type { ReactionSettings } from '@gallery/core/types';
import { nothingCollected } from './reactionSummary.ts';
import { Segmented } from './Segmented.tsx';
import c from './controls.module.css';
import s from './ReactionSettingsEditor.module.css';

export interface ReactionSettingsEditorProps {
  readonly value: ReactionSettings;
  readonly onChange: (next: ReactionSettings) => void;
  readonly disabled?: boolean;
}

type Collect = keyof ReactionSettings['collect'];

/**
 * 반응 설정(PRD G-07 표): 받기 · 받을 것 · 이름 방식 · 스티커/메모/별점 공개. 받지 않는 것의 공개 칸은 숨긴다.
 * 새 전시 만들기의 `더 설정하기`와 전시 열기 시트의 `바꾸기`가 함께 쓴다.
 */
export const ReactionSettingsEditor = ({
  value,
  onChange,
  disabled = false,
}: ReactionSettingsEditorProps) => {
  const t = copy.teacher.reactionSettings;
  const set = (patch: Partial<ReactionSettings>): void => onChange({ ...value, ...patch });
  const toggle = (key: Collect): void => set({ collect: { ...value.collect, [key]: !value.collect[key] } });
  const collectOptions: readonly { key: Collect; label: string }[] = [
    { key: 'sticker', label: t.sticker },
    { key: 'memo', label: t.memo },
    { key: 'score', label: t.score },
  ];

  return (
    <div className={s.editor} data-testid="reaction-settings">
      <Segmented
        label={t.enabled}
        value={value.enabled ? 'on' : 'off'}
        options={[
          { value: 'on', label: t.on },
          { value: 'off', label: t.off },
        ]}
        onChange={v => set({ enabled: v === 'on' })}
        disabled={disabled}
      />
      {value.enabled ? (
        <>
          <div className={s.collectRow}>
            <span className={c.label}>{t.collect}</span>
            <div className={s.chips}>
              {collectOptions.map(o => (
                <button
                  key={o.key}
                  type="button"
                  role="checkbox"
                  aria-checked={value.collect[o.key]}
                  className={value.collect[o.key] ? `${s.chip} ${s.chipOn}` : s.chip}
                  disabled={disabled}
                  onClick={() => toggle(o.key)}
                  data-testid={`collect-${o.key}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {nothingCollected(value) ? (
            <p className={c.error} role="alert">
              {t.nothingCollected}
            </p>
          ) : null}
          <Segmented
            label={t.naming}
            value={value.naming}
            options={[
              { value: 'NICKNAME', label: t.nickname },
              { value: 'ANONYMOUS', label: t.anonymous },
            ]}
            onChange={naming => set({ naming })}
            disabled={disabled}
          />
          {value.collect.sticker ? (
            <Segmented
              label={t.stickerVisibility}
              value={value.stickerVisibility}
              options={[
                { value: 'TEACHER', label: t.teacherOnly },
                { value: 'PUBLIC', label: t.everyone },
              ]}
              onChange={stickerVisibility => set({ stickerVisibility })}
              disabled={disabled}
            />
          ) : null}
          {value.collect.memo ? (
            <Segmented
              label={t.memoVisibility}
              value={value.memoVisibility}
              options={[
                { value: 'TEACHER', label: t.teacherOnly },
                { value: 'SELECTED', label: t.selected },
              ]}
              onChange={memoVisibility => set({ memoVisibility })}
              disabled={disabled}
            />
          ) : null}
          {value.collect.score ? (
            <Segmented
              label={t.scoreVisibility}
              value={value.scoreVisibility}
              options={[
                { value: 'TEACHER', label: t.teacherOnly },
                { value: 'PUBLIC', label: t.everyone },
              ]}
              onChange={scoreVisibility => set({ scoreVisibility })}
              disabled={disabled}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
};
