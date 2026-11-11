// 한국어 한 줄 주석은 허용된다.
/* 한국어 블록 주석도 허용된다. */
export const GoodPosterScreen = ({ label }: { label: string }) => {
  if (!label) throw new Error('내부 불변식 확인용 예외 메시지');
  return (
    <div>
      {/* JSX 안쪽 주석도 허용된다 */}
      <span>{label}</span>
    </div>
  );
};
