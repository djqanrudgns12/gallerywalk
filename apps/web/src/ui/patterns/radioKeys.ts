/**
 * 단추로 만든 라디오 묶음(`role="radiogroup"`)의 키보드(V-35, WAI-ARIA 라디오 묶음 규칙).
 * Tab에는 고른 칸 하나만 들어가고(`tabIndex` 0, 나머지 -1), 화살표·Home·End로 옮기면서 바로 고른다.
 * 누른 키가 옮기는 키면 옮겨 갈 칸 번호, 아니면 null.
 */
export const radioKeyStep = (key: string, index: number, count: number): number | null => {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
};
