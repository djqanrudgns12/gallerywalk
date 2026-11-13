import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { charCount, normalizeText } from '@gallery/core/types';
import { useId, useState } from 'react';
import { Sheet } from '../shared/Sheet.tsx';
import c from '../shared/controls.module.css';
import s from './PasteSheet.module.css';

export interface PasteSheetProps {
  /** 막힘 없이 저장 — 부르는 쪽이 올리기 줄에 넣는다(`useUploads().startText`) */
  readonly onSave: (title: string, body: string) => void;
  readonly onClose: () => void;
}

type Problem = { readonly field: 'title' | 'body'; readonly text: string } | null;

/**
 * 글 붙여넣기 시트(V-01, PRD G-10): 제목(필수, 작품 제목 한도)과 본문(`TEXT_MAX_CHARS`자, 줄바꿈 유지).
 * 글자 수는 서버·기기 사전 검사와 같게 정리한 본문(`normalizeText`)의 코드 포인트로 센다. 넘으면 잘라 내지 않고 막는다
 * (붙여넣은 글이 몰래 잘리지 않게 — 칸에 `maxLength`를 걸지 않는다).
 */
export const PasteSheet = ({ onSave, onClose }: PasteSheetProps) => {
  const cfg = config();
  const t = copy.teacher.paste;
  const titleId = useId();
  const bodyId = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const count = charCount(normalizeText(body));
  const max = cfg.TEXT_MAX_CHARS;

  const save = (): void => {
    const found: Problem =
      title.trim() === ''
        ? { field: 'title', text: t.titleRequired }
        : count === 0
          ? { field: 'body', text: t.bodyRequired }
          : count > max
            ? { field: 'body', text: fill(t.bodyTooLong, { max, n: count }) }
            : null;
    setProblem(found);
    if (found === null) onSave(title.trim(), body);
  };

  return (
    <Sheet
      title={t.title}
      onClose={onClose}
      testId="paste-sheet"
      footer={
        <>
          <button type="button" className={c.secondary} onClick={onClose}>
            {copy.teacher.cancel}
          </button>
          <button type="button" className={c.primary} onClick={save} data-testid="paste-save">
            {t.save}
          </button>
        </>
      }
    >
      <div className={c.field}>
        <div className={c.labelRow}>
          <label className={c.label} htmlFor={titleId}>
            {t.titleLabel}
          </label>
          <span className={c.counter}>
            {fill(copy.teacher.manage.charCount, { n: charCount(title), max: cfg.ARTWORK_TITLE_MAX_CHARS })}
          </span>
        </div>
        <input
          id={titleId}
          className={c.input}
          value={title}
          maxLength={cfg.ARTWORK_TITLE_MAX_CHARS}
          aria-invalid={problem?.field === 'title' ? true : undefined}
          data-testid="paste-title"
          onChange={e => {
            setTitle(e.target.value);
            if (problem?.field === 'title') setProblem(null);
          }}
        />
        {problem?.field === 'title' ? (
          <p className={c.error} role="alert">
            {problem.text}
          </p>
        ) : null}
      </div>
      <div className={c.field}>
        <div className={c.labelRow}>
          <label className={c.label} htmlFor={bodyId}>
            {t.bodyLabel}
          </label>
          <span className={count > max ? `${c.counter} ${s.over}` : c.counter}>
            {fill(copy.teacher.manage.charCount, { n: count, max })}
          </span>
        </div>
        <textarea
          id={bodyId}
          className={`${c.input} ${s.body}`}
          value={body}
          aria-invalid={problem?.field === 'body' ? true : undefined}
          data-testid="paste-body"
          onChange={e => {
            setBody(e.target.value);
            if (problem?.field === 'body') setProblem(null);
          }}
        />
        {problem?.field === 'body' ? (
          <p className={c.error} role="alert">
            {problem.text}
          </p>
        ) : (
          <p className={c.hint}>{t.bodyHint}</p>
        )}
      </div>
    </Sheet>
  );
};
