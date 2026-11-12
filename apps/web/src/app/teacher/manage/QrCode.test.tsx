import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { QrCode, qrPath } from './QrCode.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('QR', () => {
  it('검은 칸마다 1×1 사각형 하나', () => {
    expect(
      qrPath([
        [true, false],
        [false, true],
      ]),
    ).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
  });

  it('주소를 담은 QR을 여백 4칸과 함께 그리고, 아래에 주소 글자', () => {
    const url = 'https://gallery.example/123456';
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<QrCode value={url} />));
    const svg = host.querySelector('svg')!;
    const q = encode(url, { ecc: 'M', border: 4 });
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${q.size} ${q.size}`);
    expect(q.size).toBeGreaterThanOrEqual(21 + 8);
    expect(host.querySelector('path')!.getAttribute('d')).toBe(qrPath(q.data));
    expect(host.querySelector('figcaption')!.textContent).toBe(url);
    act(() => root.unmount());
  });
});
