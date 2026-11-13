import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * `/dev/characters` 검수 캡처(규격 `tools/assets/spec/characters.md` §5): 같은 빛 아래 정면·3/4·옆·뒤, 걷기, 얼굴 가까이.
 * 기본은 몸 틀 4종(`chr-1`). 저장소에 넣기 전 시험 파일은 환경 변수로 끼운다 — 같은 몸 틀의 지금 파일 옆에 세운다:
 *   CHAR_TRY=student-m-01 CHAR_SRC=.local/art/m4/opt/student-m-01.glb npx playwright test tests/e2e/characters-dev.spec.ts
 * 캡처는 `.local/screens/chars/<CHAR_TRY 또는 base>/`(사람이 본다). 파일이 실제로 받아지고 화면 오류가 없어야 한다.
 */

const TRY = process.env['CHAR_TRY'];
const SRC = process.env['CHAR_SRC'];
const SHOTS = `.local/screens/chars/${TRY ?? 'base'}`;
/** 검수 화면에 줄 인자: 시험 파일은 Vite `/@fs/`(작업 폴더 안 파일)로 */
const query = TRY && SRC ? `try=${TRY}&src=${encodeURIComponent(`/@fs${resolve(SRC)}`)}` : '';
const glbPart = TRY && SRC ? resolve(SRC).split('/').slice(-1)[0]! : '.glb';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const VIEWS = [
  { name: '01-front', q: 'angle=0' },
  { name: '02-three-quarter', q: 'angle=45' },
  { name: '03-side', q: 'angle=90' },
  { name: '04-back', q: 'angle=180' },
  { name: '05-walk', q: 'angle=45&clip=walk' },
  { name: '06-run', q: 'angle=90&clip=run' },
  ...(TRY ? [{ name: '07-face', q: `focus=${TRY}` }] : []),
] as const;

test('캐릭터 검수 캡처: 정면·3/4·옆·뒤·걷기·뛰기(+ 시험 파일 얼굴)', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const v of VIEWS) {
    // 실제 glb 요청만(페이지 주소의 `src=…glb` 글자에 맞지 않게 — 2026-11-14 도슨트 캡처가 받지 않고 통과했음)
    const got = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(glbPart) && r.ok(), {
      timeout: 30_000,
    });
    await page.goto(`/dev/characters?${[query, v.q].filter(Boolean).join('&')}`);
    await got;
    // 받은 뒤 붙이고 동작이 한 바퀴 돌 시간(늘 다시 그리는 검수 화면)
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS}/${v.name}.png` });
  }
  expect(errors).toEqual([]);
});
