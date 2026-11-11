import { copy } from '@gallery/core/copy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digitsOnly, entryCodeOf } from './routes.ts';
import { buttonByText, click, flush, makeServices, mountAt, typeInto } from './student/testDom.tsx';
import { deferred } from '../dev/studentFixtures.ts';

vi.mock('./visit/VisitScreen.tsx', async () => {
  const { createElement } = await import('react');
  return { VisitScreen: () => createElement('div', { 'data-testid': 'visit-screen' }) };
});

let mounted: ReturnType<typeof mountAt> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('입장 코드 판정', () => {
  it('숫자 6자리만 전시 경로', () => {
    expect(entryCodeOf('123456')).toBe('123456');
    expect(entryCodeOf('000000')).toBe('000000');
    for (const bad of ['12345', '1234567', 'abcdef', '12345a', '12 456', '１２３４５６', '', undefined])
      expect(entryCodeOf(bad)).toBeNull();
  });

  it('입력에서 숫자만 남기고 자리 수까지 자른다', () => {
    expect(digitsOnly('12 3-4a56789', 6)).toBe('123456');
    expect(digitsOnly('abc', 6)).toBe('');
    expect(digitsOnly('１２３', 6)).toBe('');
  });
});

describe('경로', () => {
  const pending = () => makeServices({ exhibition: () => deferred<never>().promise });

  it('/ → 첫 화면', () => {
    mounted = mountAt('/', pending().services);
    expect(mounted.q('[data-testid="entry-home"]')).not.toBeNull();
  });

  it('/{6자리} → 학생 전시(불러오는 동안 박물관 그리기)', () => {
    const t = pending();
    mounted = mountAt('/123456', t.services);
    expect(mounted.q('[data-testid="loading-museum"]')).not.toBeNull();
    expect(t.exhibition).toHaveBeenCalledWith('123456', expect.anything());
  });

  it.each(['/12345', '/1234567', '/abcdef', '/123456/more', '/foo/bar', '/privacyx'])('%s → /', path => {
    const t = pending();
    mounted = mountAt(path, t.services);
    expect(mounted.q('[data-testid="entry-home"]')).not.toBeNull();
    expect(t.exhibition).not.toHaveBeenCalled();
  });

  it.each(['/t', '/t/e/abc'])('%s → 교사 화면(지연 로드)', async path => {
    mounted = mountAt(path, pending().services);
    await flush(8);
    expect(mounted.q('[data-testid="teacher-app"]')).not.toBeNull();
    expect(mounted.q('[data-testid="entry-home"]')).toBeNull();
  });
});

describe('첫 화면', () => {
  it('숫자 6자리가 차면 바로 그 전시로 간다(숫자 아닌 글자는 버림)', () => {
    const t = makeServices({ exhibition: () => deferred<never>().promise });
    mounted = mountAt('/', t.services);
    const input = mounted.q<HTMLInputElement>('input');
    expect(input?.getAttribute('inputmode')).toBe('numeric');
    typeInto(input!, '12a3');
    expect(mounted.q('[data-testid="entry-home"]')).not.toBeNull();
    expect(input!.value).toBe('123');
    expect(mounted.container.querySelectorAll('[data-filled="1"]')).toHaveLength(3);
    typeInto(input!, '1234567');
    expect(mounted.q('[data-testid="entry-home"]')).toBeNull();
    expect(t.exhibition).toHaveBeenCalledWith('123456', expect.anything());
  });

  it('선생님이세요? → /t', async () => {
    mounted = mountAt('/', makeServices().services);
    click(buttonByText(mounted.container, copy.entry.teacher));
    await flush(8);
    expect(mounted.q('[data-testid="teacher-app"]')).not.toBeNull();
  });
});
