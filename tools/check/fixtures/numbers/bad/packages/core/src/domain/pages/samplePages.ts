export const calcOverlap = (v: number): number => {
  const overlapRatio = 0.05;
  const minLinePitch = 18;
  return Math.max(minLinePitch, v * overlapRatio);
};
