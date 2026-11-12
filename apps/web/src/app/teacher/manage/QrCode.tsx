import { copy, fill } from '@gallery/core/copy';
import { useMemo } from 'react';
import { encode } from 'uqr';
import s from './QrCode.module.css';

export interface QrCodeProps {
  /** QR에 담을 주소(학생 전시 `https://{도메인}/{코드}`) */
  readonly value: string;
  /** 크게 띄우기(전체 화면) */
  readonly large?: boolean;
}

/** 칸 배열 → SVG 경로 하나(검은 칸마다 1×1 사각형). 그리기 한 번, 색은 CSS `currentColor` */
export const qrPath = (data: readonly (readonly boolean[])[]): string => {
  let d = '';
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return d;
};

/** QR(P5-7, G-14): `uqr`로 칸을 만들어 SVG로 그린다. 둘레에 조용한 여백 4칸(표준), 글자 주소는 아래에 */
export const QrCode = ({ value, large = false }: QrCodeProps) => {
  const qr = useMemo(() => encode(value, { ecc: 'M', border: 4 }), [value]);
  return (
    <figure
      className={s.qr}
      data-size={large ? 'large' : 'normal'}
      data-testid="qr-code"
      data-value={value}
      aria-label={fill(copy.teacher.open.qrLabel, { url: value })}
    >
      <svg
        className={s.svg}
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-hidden="true"
      >
        <rect width={qr.size} height={qr.size} className={s.paper} />
        <path d={qrPath(qr.data)} className={s.ink} />
      </svg>
      <figcaption className={s.text}>{value}</figcaption>
    </figure>
  );
};
