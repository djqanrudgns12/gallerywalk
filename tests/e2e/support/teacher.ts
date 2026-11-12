import { randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { isWeakPin } from '../../../apps/server/src/security/pin.ts';
import { config } from '../../../packages/core/src/config.ts';
import { copy, fill } from '../../../packages/core/src/copy/ko.ts';
import { UuidSchema } from '../../../packages/core/src/types/common.ts';

export const TEACHER_SHOTS = '.local/screens/p5-11';
export const TEACHER_READY_MS = 60_000;

export interface TeacherExhibition {
  readonly id: string;
  readonly title: string;
  /** 시험 메모리에서만 보관한다. 출력·첨부·storageState에 쓰지 않는다. */
  readonly pin: string;
}

/** 함께 작업 중인 Vite의 HMR이 이 페이지의 흐름을 중간에 바꾸지 않게 한다. */
export const keepTeacherPageVersion = (page: Page): Promise<void> =>
  page.routeWebSocket(
    url => url.port === '4522' && url.pathname === '/',
    () => {},
  );

export async function captureTeacher(page: Page, name: string): Promise<void> {
  mkdirSync(TEACHER_SHOTS, { recursive: true });
  await page.screenshot({
    path: `${TEACHER_SHOTS}/${name}.png`,
    animations: 'disabled',
    mask: [page.locator('input[inputmode="numeric"]')],
  });
}

function randomPin(): string {
  let pin: string;
  do {
    pin = Array.from({ length: config().PIN_MAX_LENGTH }, () => randomInt(0, 10)).join('');
  } while (isWeakPin(pin));
  return pin;
}

/** PIN 입력 실패의 Playwright 호출 로그와 자동 오류 화면에 원문을 넘기지 않는다. */
export async function createTeacherExhibition(page: Page, title: string): Promise<TeacherExhibition> {
  const pin = randomPin();
  await page.goto('/t');
  await page.getByRole('button', { name: copy.teacher.home.create, exact: true }).click();
  await page.getByTestId('new-title').fill(title);
  try {
    await page.getByTestId('new-pin').fill(pin);
    await page.getByTestId('new-submit').click();
    await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready');
  } catch {
    await page
      .getByTestId('new-pin')
      .evaluate(el => {
        if (el instanceof HTMLInputElement) el.value = '';
      })
      .catch(() => undefined);
    throw new Error('교사 전시 만들기 실패. PIN 입력과 원본 호출 로그는 기록하지 않습니다.');
  }
  await expect(page.getByTestId('exhibition-title')).toHaveValue(title);
  await expect(page.getByTestId('teacher-toast')).toHaveText(
    fill(copy.teacher.create.createdToast, { days: config().EXHIBITION_TTL_DAYS }),
  );
  const id = UuidSchema.parse(new URL(page.url()).pathname.split('/').at(-1));
  return { id, title, pin };
}

/** 두 합성 그림은 메모리에서 만들고 실제 파일 선택 창을 통해 보낸다. */
export async function uploadTeacherArtworks(page: Page): Promise<void> {
  const files = await Promise.all(
    [
      { name: '01-상상의 산.png', sky: '#cddfe4', land: '#58766d' },
      { name: '02-노을의 산.png', sky: '#e8d2ba', land: '#96715f' },
    ].map(async art => ({
      name: art.name,
      mimeType: 'image/png',
      buffer: await sharp({
        create: { width: 1400, height: 1000, channels: 3, background: art.sky },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="1400" height="1000"><circle cx="1080" cy="220" r="100" fill="#f5e7bd"/><path d="M0 1000V700L420 260L840 760L1120 460L1400 740V1000Z" fill="${art.land}"/></svg>`,
            ),
          },
        ])
        .png()
        .toBuffer(),
    })),
  );
  const choosing = page.waitForEvent('filechooser');
  await page.getByTestId('primary-upload').click();
  await (await choosing).setFiles(files);
  const rows = page.getByTestId('upload-row');
  await expect(rows).toHaveCount(files.length);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-phase', 'done', { timeout: TEACHER_READY_MS });
    await expect(row).toContainText(copy.teacher.upload.done);
  }
  const cards = page.getByTestId('artwork-board').locator('article');
  await expect(cards).toHaveCount(files.length);
  for (const card of await cards.all()) {
    await expect(card).toHaveAttribute('data-status', 'PUBLISHED', { timeout: TEACHER_READY_MS });
    await expect(card.getByTestId('status-chip')).toHaveText(copy.teacher.status.PUBLISHED);
    await expect(card.locator('img')).toBeVisible();
  }
}

/** 새 기기에서 화면 숫자 키패드만 사용한다. 성공 후의 맥락도 디스크에 저장하지 않는다. */
export async function enterTeacherPin(page: Page, exhibition: TeacherExhibition): Promise<void> {
  await page.goto('/t');
  await expect(page.getByTestId('recent-card')).toHaveCount(0);
  await page.getByTestId('pin-open').click();
  const sheet = page.getByTestId('pin-sheet');
  await expect(sheet).toBeVisible();
  try {
    for (const digit of exhibition.pin) {
      await sheet.getByRole('button', { name: digit, exact: true }).tap();
    }
    await sheet.getByTestId('pin-submit').tap();
    await expect(page).toHaveURL(`/t/e/${exhibition.id}`);
    await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready');
  } catch {
    throw new Error('새 기기의 PIN 재입장 실패. PIN과 원본 호출 로그는 기록하지 않습니다.');
  }
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('exhibition-title')).toHaveValue(exhibition.title);
}
