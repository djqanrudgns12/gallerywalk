export const BadPosterScreen = ({ count }: { count: number }) => {
  const enterLabel = '입장하기';
  const summary = `작품 ${count}점`;
  return (
    <div style={{ backdropFilter: 'blur(4px)' }}>
      <p>✨ 전시를 준비하고 있어요</p>
      <select aria-label={enterLabel}>
        <option value="1">{summary}</option>
      </select>
    </div>
  );
};
