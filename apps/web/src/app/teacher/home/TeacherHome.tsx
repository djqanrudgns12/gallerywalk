import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { mediaPath, type ExhibitionStatus, type TeacherExhibitionView } from '@gallery/core/types';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { RecentExhibition } from '../../../ports/index.ts';
import { PrivacyLink } from '../../privacy/PrivacyLink.tsx';
import { useServices } from '../../services.ts';
import { formatDay } from '../../student/posterView.ts';
import { errorCodeOf, errorText, isAbort } from '../shared/errorText.ts';
import { TEACHER_PATHS } from '../shared/nav.ts';
import { NumberPad } from '../shared/NumberPad.tsx';
import { Sheet } from '../shared/Sheet.tsx';
import c from '../shared/controls.module.css';
import s from './TeacherHome.module.css';

/** 카드에 더할 서버 값(상태·포스터 썸네일·지워지는 날). 못 받으면 기기에 기억한 값만 */
interface CardExtra {
  readonly status: ExhibitionStatus;
  readonly thumbUrl: string | null;
  readonly expiresAt: number;
}

const posterThumb = (view: TeacherExhibitionView): string | null => {
  const poster = view.exhibition.poster;
  const v = poster?.variants.find(x => x.name === 'thumb') ?? poster?.variants.find(x => x.ext === 'webp');
  return poster && v ? mediaPath(view.exhibition.id, poster.assetId, v) : null;
};

/** 선생님 링크 조각 처리 상태 */
type LinkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'failed'; readonly message: string };

/** 링크로 못 들어온 까닭: 연결·서버 문제는 그 문구, 나머지(토큰이 죽음·전시가 없음)는 "다시 들어와 주세요" */
const linkFailText = (err: unknown): string => {
  const code = errorCodeOf(err);
  return code === 'E_OFFLINE' || code === 'E_SERVER' || code === 'E_RATE_LIMITED'
    ? errorText(err)
    : errorText(new AppError('E_AUTH'));
};

/**
 * 선생님 첫 화면 `/t`(P5-1, PLAN §7.4·§9.4 표). 최근 전시 카드(이 기기에 교사 토큰이 있는 것만, 최대
 * `RECENT_EXHIBITIONS_MAX`, 지난 전시는 기기 저장이 뺌) · `PIN으로 들어가기` · 주요 버튼 `새 전시 만들기`.
 * `/t#{토큰}`(선생님 링크, ADR-044)은 조각을 곧바로 지운 뒤 토큰으로 전시를 찾아 관리 화면으로 간다.
 */
export const TeacherHome = () => {
  const { api, device, tokens } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const [recent, setRecent] = useState<readonly RecentExhibition[]>(() =>
    device.recentExhibitions().filter(r => device.teacherSession(r.exhibitionId) !== null),
  );
  const [extra, setExtra] = useState<Readonly<Record<string, CardExtra>>>({});
  const [pinOpen, setPinOpen] = useState(false);
  const [link, setLink] = useState<LinkState>({ kind: 'idle' });
  const linkHandled = useRef<string | null>(null);

  // 선생님 링크: 조각을 먼저 지우고(주소창·방문 기록에 남지 않게) 토큰은 이 함수 안에서만 쓴다
  useEffect(() => {
    const token = location.hash.replace(/^#/, '');
    if (token === '' || linkHandled.current === token) return;
    linkHandled.current = token;
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
    if (!tokens.isToken(token)) {
      setLink({ kind: 'failed', message: errorText(new AppError('E_AUTH')) });
      return;
    }
    setLink({ kind: 'opening' });
    api.teacher.openLink(token).then(
      me => {
        device.rememberExhibition({ exhibitionId: me.exhibitionId, title: me.title });
        navigate(TEACHER_PATHS.manage(me.exhibitionId), { replace: true });
      },
      (err: unknown) => setLink({ kind: 'failed', message: linkFailText(err) }),
    );
  }, [api, device, tokens, navigate, location.hash, location.pathname, location.search]);

  // 카드의 상태 점·썸네일: 전시마다 교사 보기를 받는다. 서버에 없는 전시(E_NOT_FOUND)는 기기에서도 잊는다
  useEffect(() => {
    const ctrl = new AbortController();
    for (const r of recent) {
      api.teacher.exhibition(r.exhibitionId, { signal: ctrl.signal }).then(
        view =>
          setExtra(prev => ({
            ...prev,
            [r.exhibitionId]: {
              status: view.exhibition.status,
              thumbUrl: posterThumb(view),
              expiresAt: view.exhibition.expiresAt,
            },
          })),
        (err: unknown) => {
          if (isAbort(err)) return;
          if (errorCodeOf(err) === 'E_NOT_FOUND') {
            device.forgetExhibition(r.exhibitionId);
            setRecent(list => list.filter(x => x.exhibitionId !== r.exhibitionId));
          }
        },
      );
    }
    return () => ctrl.abort();
    // 처음 그릴 때 한 번(`recent`는 줄기만 한다 — 빠진 것을 다시 받을 필요가 없다)
  }, [api, device]);

  const t = copy.teacher.home;

  return (
    <section className={`${c.page} ${s.page}`} data-testid="teacher-home">
      <div className={s.wrap}>
        <header className={s.head}>
          <p className={s.kicker}>{copy.entry.appName}</p>
          <h1 className={s.title}>{t.title}</h1>
        </header>

        {link.kind === 'opening' ? (
          <p className={s.notice} role="status" data-testid="link-opening">
            {t.linkOpening}
          </p>
        ) : null}
        {link.kind === 'failed' ? (
          <p className={`${s.notice} ${s.noticeError}`} role="alert" data-testid="link-failed">
            {link.message}
          </p>
        ) : null}

        <section className={s.recent} aria-labelledby="teacher-recent-title">
          <h2 id="teacher-recent-title" className={s.sectionTitle}>
            {t.recentTitle}
          </h2>
          {recent.length === 0 ? (
            <p className={s.empty} data-testid="recent-empty">
              {t.empty}
            </p>
          ) : (
            <ul className={s.cards}>
              {recent.map(r => {
                const more = extra[r.exhibitionId];
                const expiresAt = more?.expiresAt ?? r.expiresAt;
                return (
                  <li key={r.exhibitionId}>
                    <button
                      type="button"
                      className={s.card}
                      onClick={() => navigate(TEACHER_PATHS.manage(r.exhibitionId))}
                      data-testid="recent-card"
                      data-id={r.exhibitionId}
                    >
                      <span className={s.thumb} aria-hidden="true">
                        {more?.thumbUrl ? (
                          <img className={s.thumbImg} src={more.thumbUrl} alt="" loading="lazy" />
                        ) : (
                          <span className={s.nameplate}>{r.title}</span>
                        )}
                      </span>
                      <span className={s.cardBody}>
                        <span className={s.cardTitle}>{r.title}</span>
                        <span className={s.cardMeta}>
                          {more ? (
                            <span className={c.statusDot} data-status={more.status}>
                              {copy.teacher.exhibitionStatus[more.status]}
                            </span>
                          ) : null}
                          {expiresAt !== null ? (
                            <span className={s.expires}>
                              {fill(t.deletesOn, { date: formatDay(expiresAt) })}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className={s.actions}>
          <button
            type="button"
            className={c.secondary}
            onClick={() => setPinOpen(true)}
            data-testid="pin-open"
          >
            {t.pinEnter}
          </button>
          <button
            type="button"
            className={c.primary}
            onClick={() => navigate(TEACHER_PATHS.create)}
            data-testid="create-open"
          >
            {t.create}
          </button>
        </div>
        <PrivacyLink />
      </div>

      {pinOpen ? <PinSheet onClose={() => setPinOpen(false)} /> : null}
    </section>
  );
};

/** `PIN으로 들어가기` 시트: 숫자 키패드 → `pinLogin` → 관리 화면. 틀림·잠김은 키패드 위에 */
const PinSheet = ({ onClose }: { readonly onClose: () => void }) => {
  const { api, device } = useServices();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { PIN_MIN_LENGTH: min, PIN_MAX_LENGTH: max } = config();
  const t = copy.teacher.pin;
  const ready = pin.length >= min && !busy;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { exhibitionId } = await api.teacher.pinLogin(pin);
      // 카드 이름: 기억한 것이 없으면 `me`로 받는다(못 받아도 들어간다 — 관리 화면이 다시 기억)
      const known = device.recentExhibitions().find(r => r.exhibitionId === exhibitionId);
      const title =
        known?.title ??
        (await api.teacher.me(exhibitionId).then(
          m => m.title,
          () => null,
        ));
      if (title !== null) device.rememberExhibition({ exhibitionId, title });
      navigate(TEACHER_PATHS.manage(exhibitionId));
    } catch (err) {
      setError(errorText(err));
      setPin('');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={t.title}
      onClose={onClose}
      testId="pin-sheet"
      footer={
        <button
          type="button"
          className={c.primary}
          disabled={!ready}
          onClick={() => void submit()}
          data-testid="pin-submit"
        >
          {busy ? t.submitting : t.submit}
        </button>
      }
    >
      <p className={c.hint}>{fill(t.hint, { min, max })}</p>
      {error ? (
        <p className={c.error} role="alert" data-testid="pin-error">
          {error}
        </p>
      ) : null}
      <NumberPad
        label={t.label}
        value={pin}
        onChange={v => {
          setPin(v);
          if (error) setError(null);
        }}
        minLength={min}
        maxLength={max}
        disabled={busy}
        onSubmit={() => void submit()}
      />
    </Sheet>
  );
};
