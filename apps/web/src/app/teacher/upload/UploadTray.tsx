import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { Icon } from '../../../ui/index.ts';
import type { UploadProblem } from './precheck.ts';
import { isFinished, type UploadTask } from './uploadQueue.ts';
import s from './upload.module.css';

/** 막힘·실패 한 줄(PRD 15.3 "이유와 해결법이 한 줄로") */
export const problemText = (problem: UploadProblem): string => errorCopy[problem];

/** 해결법(있을 때만). 수치는 설정에서. PDF는 깨짐 해결법이 다르다(암호) */
export const problemFix = (problem: UploadProblem, about: { readonly pdf?: boolean } = {}): string | null => {
  const cfg = config();
  const fix = copy.teacher.upload.fix;
  switch (problem) {
    case 'E_FILE_TOO_LARGE':
      return fill(fix.tooLarge, { image: cfg.MAX_IMAGE_MB, audio: cfg.MAX_AUDIO_MB });
    case 'E_FILE_TYPE':
      return fix.fileTypeWithPdf;
    case 'E_FILE_BROKEN':
      return about.pdf === true ? fix.pdfBroken : fix.broken;
    case 'E_TEXT_LENGTH':
      return fill(fix.textLength, { n: cfg.TEXT_MAX_CHARS.toLocaleString('ko-KR') });
    case 'E_DUPLICATE':
      return fix.duplicate;
    case 'E_QUOTA':
      return fix.quota;
    case 'E_OFFLINE':
      return fix.offline;
    default:
      return null;
  }
};

const phaseText = (t: UploadTask): string => {
  const u = copy.teacher.upload;
  switch (t.phase) {
    case 'checking':
      return u.checking;
    case 'waiting':
      return t.problem === null ? u.waiting : problemText(t.problem);
    case 'rendering':
      return fill(u.rendering, { done: t.pages?.done ?? 0, total: t.pages?.total ?? 0 });
    case 'sending':
      return t.pages
        ? fill(u.sendingPages, { done: t.pages.done, total: t.pages.total })
        : fill(u.sending, { pct: Math.round(t.progress * 100) });
    case 'confirming':
      return u.confirming;
    case 'done':
      return t.lowRes ? copy.teacher.upload.lowRes : u.done;
    default:
      return t.problem === null ? u.failed : problemText(t.problem);
  }
};

export interface UploadTrayProps {
  readonly tasks: readonly UploadTask[];
  readonly onClear: () => void;
}

/** 올리는 중인 파일 목록(동시 3개, 진행률, 결과·오류 한 줄 + 해결법) */
export const UploadTray = ({ tasks, onClear }: UploadTrayProps) => {
  if (tasks.length === 0) return null;
  const finished = tasks.filter(t => isFinished(t.phase)).length;
  return (
    <section className={s.tray} aria-label={copy.teacher.upload.trayTitle} data-testid="upload-tray">
      <header className={s.trayHead}>
        <h2 className={s.trayTitle}>
          {fill(copy.teacher.upload.trayCount, { done: finished, total: tasks.length })}
        </h2>
        {finished > 0 ? (
          <button type="button" className={s.clear} onClick={onClear}>
            {copy.teacher.upload.clear}
          </button>
        ) : null}
      </header>
      <ul className={s.list}>
        {tasks.map(t => {
          const bad = t.phase === 'blocked' || t.phase === 'failed' || t.phase === 'duplicate';
          const fix = bad && t.problem !== null ? problemFix(t.problem, { pdf: t.pdf }) : null;
          return (
            <li
              key={t.key}
              className={bad ? `${s.row} ${s.rowBad}` : s.row}
              data-testid="upload-row"
              data-phase={t.phase}
              data-problem={t.problem ?? undefined}
              data-pages={t.pages ? `${t.pages.done}/${t.pages.total}` : undefined}
            >
              <span className={s.name}>
                {t.target.type === 'BGM' ? `${copy.teacher.upload.bgm} · ${t.name}` : t.name}
              </span>
              <span className={s.state}>
                {bad ? (
                  <Icon name="warning" size={14} />
                ) : t.phase === 'done' ? (
                  <Icon name="check" size={14} />
                ) : null}
                <span>{phaseText(t)}</span>
              </span>
              {fix ? <span className={s.fix}>{fix}</span> : null}
              {t.phase === 'sending' || t.phase === 'rendering' ? (
                <span className={s.bar} aria-hidden="true">
                  <span className={s.barFill} style={{ inlineSize: `${Math.round(t.progress * 100)}%` }} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
