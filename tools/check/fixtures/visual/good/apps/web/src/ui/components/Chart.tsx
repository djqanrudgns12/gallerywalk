export const paint = (ctx: CanvasRenderingContext2D): void => {
  // 캔버스 그리기는 UI 장식이 아니다: createLinearGradient·createRadialGradient·createConicGradient
  const g = ctx.createLinearGradient(0, 0, 10, 0);
  ctx.fillStyle = g;
};

/* 블록 주석의 'black'과 linear-gradient( 도 잡지 않는다 */
export const label = 'black';
export const theme = { blackout: true, name: 'Paint it black', palette: 'black' };
export const shadow = 'rgba(0, 0, 0, 0.35)';
export const halo = 'rgb(0 0 0 / 0.2)';
export const Swatch = () => <span data-tone="black" aria-label="black" style={{ color: 'var(--black)' }} />;
