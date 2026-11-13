import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon, type IconName } from '../../ui/Icon.tsx';
import { entryCodeOf, PATHS } from '../routes.ts';
import { useServices } from '../services.ts';
import { DigitsInput } from '../teacher/shared/DigitsInput.tsx';
import c from '../teacher/shared/controls.module.css';
import { browserCheckEnv, type CheckEnv } from './browserDeps.ts';
import { requestText, resultLine, secText, stampOf, summaryOf, type Summary } from './report.ts';
import { initialResults, runCheck, type StepResult, type StepState } from './steps.ts';
import s from './CheckScreen.module.css';

/** 교사 화면과 같은 밝은 준비실 테마(`TeacherApp`) */
const TEACHER_THEME = 'modern-history';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly results: readonly StepResult[] }
  | {
      readonly kind: 'done';
      readonly results: readonly StepResult[];
      readonly summary: Summary;
      readonly request: string;
    };

type CopyState = 'idle' | 'copied' | 'failed';

const STATE_ICON: Partial<Record<StepState, IconName>> = { ok: 'check', slow: 'warning', fail: 'close' };
const SUMMARY_ICON: Readonly<Record<Summary, IconName>> = {
  ok: 'check',
  slow: 'warning',
  blocked: 'warning',
  unreachable: 'warning',
  no3d: 'warning',
};
const STEP_ICON_PX = 16;
const SUMMARY_ICON_PX = 20;
/** 복사하지 못했을 때 보이는 글 상자 높이(줄) */
const REQUEST_BOX_ROWS = 12;

export interface CheckScreenProps {
  /** 시험이 가짜를 넣는다. 없으면 브라우저 것(점검을 누를 때 만든다) */
  readonly env?: (() => CheckEnv) | undefined;
}

/**
 * 학교망 점검 `/check`(FIELD_PLAN HW-00·HW-07). 선생님·정보 담당이 학교 와이파이에 붙은 기기로 열어 어디서 막히는지 1분 안에 본다.
 * 단계별 상태·걸린 시간 → 결과 한 줄 → `자세히`(기술 이름) → 정보 담당에게 보낼 글 복사. 결과는 이 기기에만 있고 서버에 보내지 않는다.
 * `App.tsx`가 지연 로드한다 — 3D 엔진을 가져오지 않는다.
 */
export const CheckScreen = ({ env }: CheckScreenProps) => {
  const t = copy.check;
  const { userAgent } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const titleId = useId();
  const requestId = useId();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const alive = useRef(true);
  const usedEnv = useRef<CheckEnv | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const running = phase.kind === 'running';
  const results = phase.kind === 'idle' ? initialResults() : phase.results;

  const start = async (): Promise<void> => {
    if (running) return;
    const e = (env ?? (() => browserCheckEnv(userAgent)))();
    usedEnv.current = e;
    setCopyState('idle');
    setPhase({ kind: 'running', results: initialResults() });
    const final = await runCheck(e.deps, { code: entryCodeOf(code) }, r => {
      if (alive.current) setPhase({ kind: 'running', results: r });
    });
    if (!alive.current) return;
    const request = requestText(final, { host: e.host, date: stampOf(e.clock()), device: e.device });
    setPhase({ kind: 'done', results: final, summary: summaryOf(final), request });
  };

  const copyRequest = async (text: string): Promise<void> => {
    const write = usedEnv.current?.writeClipboard;
    try {
      if (!write) throw new Error('clipboard unavailable');
      await write(text);
      if (alive.current) setCopyState('copied');
    } catch {
      if (alive.current) setCopyState('failed');
    }
  };

  // 선생님 화면에서 왔으면 그리로, 주소로 바로 열었으면 선생님 첫 화면으로
  const back = (): void => {
    if (location.key !== 'default') void navigate(-1);
    else void navigate(PATHS.teacher);
  };

  return (
    <main className={`${c.page} ${s.page}`} data-theme={TEACHER_THEME} data-testid="check-screen">
      <article className={s.plate} aria-labelledby={titleId}>
        <header className={s.head}>
          <p className={s.kicker}>{copy.entry.appName}</p>
          <h1 id={titleId} className={s.title}>
            {t.title}
          </h1>
          <p className={s.lead}>{t.lead}</p>
        </header>

        <div className={s.form}>
          <DigitsInput
            label={t.codeLabel}
            value={code}
            onChange={setCode}
            maxLength={config().ENTRY_CODE_DIGITS}
            testId="check-code"
            onEnter={() => void start()}
          />
          <button
            type="button"
            className={c.primary}
            disabled={running}
            onClick={() => void start()}
            data-testid="check-start"
          >
            {phase.kind === 'done' ? t.again : t.start}
          </button>
        </div>

        <ol className={s.steps} aria-busy={running} data-testid="check-steps">
          {results.map((r, i) => (
            <StepRow key={r.id} result={r} n={i + 1} />
          ))}
        </ol>

        {phase.kind === 'done' ? (
          <>
            <p className={s.summary} data-summary={phase.summary} role="status" data-testid="check-summary">
              <Icon name={SUMMARY_ICON[phase.summary]} size={SUMMARY_ICON_PX} className={s.summaryIcon} />
              <span>{t.summary[phase.summary]}</span>
            </p>

            <details className={s.more} data-testid="check-details">
              <summary className={s.moreSummary}>{t.details}</summary>
              <ul className={s.detailList}>
                {phase.results.map((r, i) => (
                  <li key={r.id}>{resultLine(r, i)}</li>
                ))}
              </ul>
            </details>

            <section className={s.request} aria-labelledby={requestId}>
              <h2 id={requestId} className={s.sectionTitle}>
                {t.requestTitle}
              </h2>
              <button
                type="button"
                className={c.secondary}
                onClick={() => void copyRequest(phase.request)}
                data-testid="check-copy"
              >
                {t.copy}
              </button>
              {copyState === 'copied' ? (
                <p className={c.hint} role="status" data-testid="check-copied">
                  {t.copied}
                </p>
              ) : null}
              {copyState === 'failed' ? (
                <>
                  <p className={c.error} role="alert" data-testid="check-copy-failed">
                    {t.copyFailed}
                  </p>
                  <textarea
                    className={s.requestBox}
                    readOnly
                    rows={REQUEST_BOX_ROWS}
                    value={phase.request}
                    aria-labelledby={requestId}
                    onFocus={e => e.currentTarget.select()}
                    data-testid="check-request"
                  />
                </>
              ) : null}
            </section>
          </>
        ) : null}

        <p className={s.privacy}>{t.privacyNote}</p>
        <button type="button" className={c.ghost} onClick={back} data-testid="check-back">
          {t.back}
        </button>
      </article>
    </main>
  );
};

const StepRow = ({ result: r, n }: { readonly result: StepResult; readonly n: number }) => {
  const t = copy.check;
  const icon = STATE_ICON[r.state];
  return (
    <li className={s.step} data-state={r.state} data-step={r.id} data-testid="check-step">
      <span className={s.num} aria-hidden="true">
        {n}
      </span>
      <span className={s.stepName}>{t.steps[r.id]}</span>
      <span className={s.stepMeta}>
        {r.mbps !== null ? (
          <span className={s.value}>{fill(t.speedValue, { mbps: r.mbps.toFixed(1) })}</span>
        ) : null}
        {r.ms !== null ? <span className={s.value}>{fill(t.took, { sec: secText(r.ms) })}</span> : null}
        <span className={s.state}>
          {icon ? <Icon name={icon} size={STEP_ICON_PX} /> : null}
          {t.state[r.state]}
        </span>
      </span>
    </li>
  );
};
