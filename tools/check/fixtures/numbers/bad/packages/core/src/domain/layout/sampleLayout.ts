export const calcMargin = (w: number): number => {
  const cornerMargin = 0.8;
  const maxWall = 16;
  const offset = -2;
  return w - cornerMargin * 2 + maxWall + offset;
};
