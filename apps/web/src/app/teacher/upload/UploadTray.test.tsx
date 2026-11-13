import { copy, fill } from '@gallery/core/copy';
import type { ArtworkTeacher } from '@gallery/core/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { teacherArtwork } from '../../../dev/teacherFixtures.ts';
import type { UploadTask } from './uploadQueue.ts';
import { imagePagesOf, screenViewport, UploadTray } from './UploadTray.tsx';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const task = (a: ArtworkTeacher, over: Partial<UploadTask> = {}): UploadTask => ({
  key: a.id,
  name: `${a.title}.png`,
  target: { type: 'ARTWORK', artworkId: a.id, roomId: a.roomId, order: a.order, title: a.title },
  phase: 'done',
  progress: 1,
  problem: null,
  lowRes: false,
  pdf: false,
  pages: null,
  ...over,
});

const render = (tasks: readonly UploadTask[], artworks: readonly ArtworkTeacher[]): HTMLElement => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<UploadTray tasks={tasks} artworks={artworks} onClear={() => undefined} />));
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
};

const shaped = (form: 'TALL' | 'PANORAMA', w: number, h: number): ArtworkTeacher => {
  const base = teacherArtwork(0, form === 'TALL' ? 0 : 1);
  if (!base.image) throw new Error('fixture image');
  return { ...base, form, formAuto: form, image: { ...base.image, w, h } };
};

describe('올리기 결과 한 줄(V-18, PRD 6.9 "웹툰이라 3쪽으로 나눠 보여 줘요")', () => {
  it('쪽으로 나눠 보이는 그림은 끝난 줄에 쪽 수 한 줄', () => {
    const a = shaped('TALL', 800, 9000);
    const p = shaped('PANORAMA', 12000, 900);
    const plain = teacherArtwork(0, 2);
    const el = render([task(a), task(p), task(plain)], [a, p, plain]);
    const notes = Array.from(el.querySelectorAll('[data-testid="upload-note"]')).map(n => n.textContent);
    const vp = screenViewport();
    expect(imagePagesOf(a, vp)).toBeGreaterThan(1);
    expect(imagePagesOf(p, vp)).toBeGreaterThan(1);
    expect(notes).toEqual([
      fill(copy.teacher.upload.splitTall, { n: imagePagesOf(a, vp) }),
      fill(copy.teacher.upload.splitPanorama, { n: imagePagesOf(p, vp) }),
    ]);
  });

  it('보내는 중이거나 한 장이면 한 줄이 없다', () => {
    const a = shaped('TALL', 800, 9000);
    const el = render([task(a, { phase: 'sending', progress: 0.5 })], [a]);
    expect(el.querySelector('[data-testid="upload-note"]')).toBeNull();
  });
});
