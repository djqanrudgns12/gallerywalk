export const Badge = () => (
  <div style={{ background: 'radial-gradient(circle, var(--a), var(--b))', color: 'black' }}>
    <svg aria-hidden="true">
      <rect fill="black" stroke="#000f" />
    </svg>
  </div>
);

export const inlineCss = `
  .x {
    outline: 2px solid black;
  }
`;

export const hardShadow = 'rgba(0, 0, 0, 1)';
