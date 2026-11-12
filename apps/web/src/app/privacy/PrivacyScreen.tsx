import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { useId } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { STUDENT_THEME } from '../student/theme.ts';
import s from './PrivacyScreen.module.css';

/** 초 → 일(단위 바꾸기) */
const SEC_PER_DAY = 86_400;

/**
 * 개인정보처리방침 `/privacy`(P6-8, PRD 13.3, PLAN §9.6 "보장 범위"·§11.5). 학생·교사 공통, `App.tsx`가 지연 로드한다.
 * 위는 초5가 읽는 쉬운 글, 아래 `보호자·선생님께`는 접힌 자세한 항목. 운영자 정보(U-10)는 `copy.privacy.operatorInfo` 한 곳에서만
 * 채우고, 비어 있으면 빈칸 표시를 그대로 보인다(지어내지 않음).
 */
export const PrivacyScreen = () => {
  const t = copy.privacy;
  const navigate = useNavigate();
  const location = useLocation();
  const titleId = useId();
  const easyId = useId();
  const c = config();
  const values = {
    days: c.EXHIBITION_TTL_DAYS,
    sec: c.RETENTION_JOB_SEC,
    cdnDays: Math.ceil(c.MEDIA_CDN_MAX_AGE_SEC / SEC_PER_DAY),
  };
  // 앱 안에서 왔으면 그 화면으로, 새 탭·주소로 바로 열었으면 첫 화면으로
  const back = (): void => {
    if (location.key !== 'default') void navigate(-1);
    else void navigate('/');
  };
  const operator: readonly { readonly label: string; readonly value: string; readonly key: string }[] = [
    { key: 'name', label: t.operatorName, value: t.operatorInfo.name },
    { key: 'contact', label: t.operatorContact, value: t.operatorInfo.contact },
    { key: 'effective', label: t.operatorEffective, value: t.operatorInfo.effectiveDate },
  ];

  return (
    <main className={s.page} data-theme={STUDENT_THEME} data-testid="privacy-screen">
      <article className={s.plate} aria-labelledby={titleId}>
        <p className={s.kicker}>{copy.entry.appName}</p>
        <h1 id={titleId} className={s.title}>
          {t.title}
        </h1>
        <p className={s.lead}>{t.lead}</p>

        <section className={s.easy} aria-labelledby={easyId} data-testid="privacy-easy">
          <h2 id={easyId} className={s.easyTitle}>
            {t.easyTitle}
          </h2>
          <ul className={s.easyList}>
            {t.easy.map(line => (
              <li key={line}>{fill(line, values)}</li>
            ))}
          </ul>
        </section>

        <details className={s.more} data-testid="privacy-more">
          <summary className={s.summary}>{t.more}</summary>
          <div className={s.moreBody}>
            {t.sections.map(section => (
              <section key={section.title} className={s.section}>
                <h3 className={s.sectionTitle}>{section.title}</h3>
                <ul className={s.list}>
                  {section.items.map(item => (
                    <li key={item}>{fill(item, values)}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>

        <section className={s.section} data-testid="privacy-operator">
          <h2 className={s.sectionTitle}>{t.operatorTitle}</h2>
          <dl className={s.operator}>
            {operator.map(row => (
              <div key={row.key} className={s.operatorRow}>
                <dt>{row.label}</dt>
                <dd>
                  {row.value.trim() ? (
                    row.value
                  ) : (
                    <span className={s.blank} data-blank={row.key}>
                      {t.blank}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <button type="button" className={s.back} onClick={back} data-testid="privacy-back">
          {t.back}
        </button>
      </article>
    </main>
  );
};
