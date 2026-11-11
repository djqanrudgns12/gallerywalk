import { computeLayout } from '@gallery/core/layout';
import { useEffect, useState } from 'react';
import { hashFixtures } from './hashFixtures.ts';

/**
 * `/dev/hash` — 브라우저에서 고정 입력 20개의 배치 해시를 계산해 `window.__layoutHashes`에 내놓는다(PLAN §4.11).
 * `tests/e2e/layout-hash.spec.ts`가 Node에서 계산한 값과 비교한다.
 */

declare global {
  interface Window {
    __layoutHashes?: string[];
  }
}

export const HashDev = () => {
  const [hashes, setHashes] = useState<string[]>([]);
  useEffect(() => {
    const out = hashFixtures().map(input => computeLayout(input).hash);
    window.__layoutHashes = out;
    setHashes(out);
  }, []);
  return (
    <pre data-testid="layout-hashes" style={{ padding: 16 }}>
      {hashes.join('\n')}
    </pre>
  );
};
