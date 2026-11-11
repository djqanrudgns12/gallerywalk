export const allowedSteps = (x: number): number => {
  const zero = 0;
  const one = 1;
  const two = 2;
  const minusOne = -1;
  return x * two + one + zero + minusOne;
};
