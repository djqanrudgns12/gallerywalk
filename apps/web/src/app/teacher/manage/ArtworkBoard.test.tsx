import { copy, fill } from '@gallery/core/copy';
import type { ArtworkTeacher } from '@gallery/core/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { teacherArtwork } from '../../../dev/teacherFixtures.ts';
import { imagePagesOf, screenViewport } from '../upload/UploadTray.tsx';
import { CardFace } from './ArtworkBoard.tsx';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const render = (a: ArtworkTeacher): string => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<CardFace exhibitionId="ex" artwork={a} selected={false} dragging={false} />));
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el.textContent ?? '';
};

const tall = (): ArtworkTeacher => {
  const base = teacherArtwork(0, 0);
  if (!base.image) throw new Error('fixture image');
  return { ...base, form: 'TALL', formAuto: 'TALL', image: { ...base.image, w: 800, h: 9000 } };
};

const pdf = (pages: number): ArtworkTeacher => {
  const base = teacherArtwork(0, 1);
  const img = base.image;
  if (!img) throw new Error('fixture image');
  return {
    ...base,
    kind: 'PDF',
    form: 'MULTIPAGE',
    formAuto: 'MULTIPAGE',
    image: null,
    pages: Array.from({ length: pages }, (_, i) => ({ ...img, idx: i + 1 })),
  };
};

describe('카드 쪽 수(V-18, PRD 6.9·6.7)', () => {
  it('한 장이면 쪽 수를 보이지 않는다', () => {
    const text = render(teacherArtwork(0, 0));
    expect(text).not.toContain(fill(copy.teacher.pageCount, { n: 1 }));
  });

  it('긴 세로 그림은 쪽 계획기로 센 쪽 나눔 수를 보인다', () => {
    const a = tall();
    const n = imagePagesOf(a, screenViewport());
    expect(n).toBeGreaterThan(1);
    expect(render(a)).toContain(fill(copy.teacher.pageSplitCount, { n }));
  });

  it('PDF는 쪽 수 그대로', () => {
    expect(render(pdf(3))).toContain(fill(copy.teacher.pageCount, { n: 3 }));
  });
});
