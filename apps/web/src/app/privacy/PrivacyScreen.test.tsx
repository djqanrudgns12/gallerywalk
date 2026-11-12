import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE } from '../../dev/studentFixtures.ts';
import { click, flush, flushUntil, makeServices, mountAt, typeInto } from '../student/testDom.tsx';
import { PRIVACY_PATH } from './path.ts';

vi.mock('../visit/VisitScreen.tsx', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    VisitScreen: (p: { readonly onProgress?: (v: { ready: boolean; progress: number }) => void }) => {
      // 한 번만 준비 끝을 알린다(속성이 그릴 때마다 바뀌므로 의존값 없음)
      useEffect(() => p.onProgress?.({ ready: true, progress: 1 }), []);
      return createElement('div', { 'data-testid': 'visit-screen' });
    },
  };
});

let mounted: ReturnType<typeof mountAt> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const t = copy.privacy;
const openPrivacy = async () => {
  const m = mountAt(PRIVACY_PATH, makeServices().services);
  mounted = m;
  await flushUntil(() => m.q('[data-testid="privacy-screen"]') !== null);
  return m;
};

describe('개인정보처리방침 `/privacy`(P6-8)', () => {
  it('지연 로드로 열리고, 쉬운 글에 보관 일수가 채워진다', async () => {
    const m = await openPrivacy();
    expect(m.q('h1')?.textContent).toBe(t.title);
    const easy = m.q('[data-testid="privacy-easy"]');
    expect(easy?.querySelectorAll('li')).toHaveLength(t.easy.length);
    expect(easy?.textContent).toContain(`${config().EXHIBITION_TTL_DAYS}일`);
    expect(m.q('[data-testid="entry-home"]')).toBeNull();
  });

  it('보호자·선생님용 자세한 항목은 접혀 있고, PLAN §9.6 보장 범위를 설정값으로 채운다', async () => {
    const m = await openPrivacy();
    const more = m.q<HTMLDetailsElement>('[data-testid="privacy-more"]');
    expect(more?.open).toBe(false);
    expect(more?.querySelector('summary')?.textContent).toBe(t.more);
    const text = more?.textContent ?? '';
    for (const section of t.sections) expect(text).toContain(section.title);
    expect(text).toContain(`${config().RETENTION_JOB_SEC}초 안에 지워져요`);
    expect(text).toContain(`길어야 ${Math.ceil(config().MEDIA_CDN_MAX_AGE_SEC / 86_400)}일`);
    expect(text).toContain('다음에 열 때 지워져요');
    expect(text).toContain('제3자에게 제공하지 않아요');
    expect(text).toContain('외부 AI 서비스를 쓰지 않아요');
    expect(text).toContain('만 14세 미만');
    // 채우지 않은 자리(`{…}`)가 남지 않는다
    expect(m.text()).not.toMatch(/\{\w+\}/);
  });

  it('운영자 정보(U-10)는 비어 있으면 빈칸 표시, 값은 copy.privacy.operatorInfo 한 곳에서만 온다', async () => {
    const m = await openPrivacy();
    const operator = m.q('[data-testid="privacy-operator"]');
    const info = t.operatorInfo as Readonly<Record<string, string>>;
    const empty = Object.values(info).filter(v => v.trim() === '').length;
    const blanks = operator?.querySelectorAll('[data-blank]') ?? [];
    expect(blanks).toHaveLength(empty);
    for (const b of blanks) expect(b.textContent).toBe(t.blank);
    expect(operator?.textContent).toContain(t.operatorName);
    expect(operator?.textContent).toContain(t.operatorContact);
    expect(operator?.textContent).toContain(t.operatorEffective);
  });

  it('주소로 바로 열었으면 돌아가기는 첫 화면', async () => {
    const m = await openPrivacy();
    click(m.q('[data-testid="privacy-back"]'));
    await flush();
    expect(m.q('[data-testid="entry-home"]')).not.toBeNull();
  });
});

describe('처리방침 링크 자리', () => {
  it('학생 첫 화면 아래 → 같은 탭으로 열고, 돌아가기는 첫 화면', async () => {
    const m = mountAt('/', makeServices().services);
    mounted = m;
    const link = m.q<HTMLAnchorElement>('[data-testid="privacy-link"]');
    expect(link?.getAttribute('href')).toBe(PRIVACY_PATH);
    expect(link?.textContent).toBe(t.link);
    expect(link?.target).toBe('');
    click(link);
    await flushUntil(() => m.q('[data-testid="privacy-screen"]') !== null);
    expect(m.q('[data-testid="privacy-screen"]')).not.toBeNull();
    click(m.q('[data-testid="privacy-back"]'));
    await flush();
    expect(m.q('[data-testid="entry-home"]')).not.toBeNull();
  });

  it('포스터 아래와 동의 시트 안 → 새 탭(보던 흐름을 잃지 않게)', async () => {
    const s = makeServices();
    const m = mountAt(`/${CODE}`, s.services);
    mounted = m;
    await flush();
    const posterLink = m.q<HTMLAnchorElement>('[data-testid="privacy-link"]');
    expect(posterLink?.getAttribute('href')).toBe(PRIVACY_PATH);
    expect(posterLink?.target).toBe('_blank');
    expect(posterLink?.rel).toBe('noopener');
    typeInto(m.q<HTMLInputElement>('[data-testid="entry-poster"] input')!, '하늘고래');
    await act(async () => {});
    click(m.q('[data-testid="enter-plaza-btn"]'));
    const dialogLink = m.q<HTMLAnchorElement>('[role="dialog"] [data-testid="privacy-link"]');
    expect(dialogLink?.getAttribute('href')).toBe(PRIVACY_PATH);
    expect(dialogLink?.target).toBe('_blank');
  });

  it('선생님 첫 화면 아래', async () => {
    const m = mountAt('/t', makeServices().services);
    mounted = m;
    await flushUntil(() => m.q('[data-testid="teacher-home"]') !== null);
    const link = m.q<HTMLAnchorElement>('[data-testid="teacher-home"] [data-testid="privacy-link"]');
    expect(link?.getAttribute('href')).toBe(PRIVACY_PATH);
    expect(link?.textContent).toBe(t.link);
  });
});
