import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRANSCODER_PATH } from './gltf.ts';

/**
 * 운영 CSP는 `script-src 'self' 'wasm-unsafe-eval'`이라 문자열을 코드로 만드는 것(`new Function`·`eval`)을 막는다.
 * 그런데 three가 함께 주는 Basis 변환기(Emscripten embind)는 함수를 문자열로 만들어, 운영에서만 변환기가 시작하지 못했고
 * KTX2 그림을 기다리느라 캐릭터·템플릿 glb가 끝내 읽히지 않았다(2026-11-13, ADR-069). 자체 배포하는 변환기는 그 두 곳을
 * 클로저로 바꾼 판이어야 한다.
 */
const publicFile = (name: string): string =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../public', TRANSCODER_PATH, name),
    'utf8',
  );

describe('KTX2 변환기는 운영 CSP 안에서 돈다', () => {
  it('문자열로 함수를 만들지 않는다', () => {
    const js = publicFile('basis_transcoder.js');
    expect(js).not.toMatch(/newFunc\(\s*Function\b/);
    expect(js).not.toMatch(/(?<![\w.$])(?:new\s+)?Function\s*\(/);
    expect(js).not.toMatch(/(?<![\w.$])eval\s*\(/);
  });

  it('고친 판은 원래 판과 다른 폴더에 둔다(옛 파일이 1년 immutable로 캐시돼 있음)', () => {
    expect(TRANSCODER_PATH).not.toBe('/assets/g/basis-r187/');
  });
});
