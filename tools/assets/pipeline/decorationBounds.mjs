/** 실제 glTF 외곽과 배치 계약 대조. Blender Z-위가 아닌 glTF Y-위 좌표를 받는다. */
export const decorationBoundsProblems = (name, bounds, size, wallMargin) => {
  const problems = [];
  const mm = 0.001;
  if (Math.max(-bounds.min[0], bounds.max[0]) > size.w / 2 + mm) problems.push(`${name}: 장식 너비 계약 밖`);
  if (bounds.min[1] < -mm || bounds.max[1] > size.h + mm) problems.push(`${name}: 장식 높이 계약 밖`);
  if (Math.max(-bounds.min[2], bounds.max[2]) > size.d / 2 + mm) problems.push(`${name}: 장식 깊이 계약 밖`);
  if (size.d > wallMargin) problems.push(`${name}: 장식 계약이 보행 여유 밖`);
  return problems;
};
