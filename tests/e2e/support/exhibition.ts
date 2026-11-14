import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { isWeakPin } from '../../../apps/server/src/security/pin.ts';
import { config } from '../../../packages/core/src/config.ts';
import { ApiErrorSchema, okEnvelope } from '../../../packages/core/src/types/api.ts';
import { EntryCodeSchema, UuidSchema } from '../../../packages/core/src/types/common.ts';
import {
  CreateExhibitionResultSchema,
  CreateExhibitionSchema,
  ExhibitionTeacherSchema,
  ExhibitionViewSchema,
} from '../../../packages/core/src/types/exhibition.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SERVER = 'http://127.0.0.1:4521';
const runFile = promisify(execFile);
const SeedSchema = z.object({
  exhibitionId: UuidSchema,
  entryCode: EntryCodeSchema,
  teacherToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  artworks: z.number().int().positive(),
  /** 시드가 만든 종류별 수(`--with-pages`의 웹툰·A4는 IMAGE) */
  kinds: z.object({
    IMAGE: z.number().int().nonnegative(),
    TEXT: z.number().int().nonnegative(),
    PDF: z.number().int().nonnegative(),
    AUDIO: z.number().int().nonnegative(),
  }),
});

export type SeededExhibition = z.infer<typeof SeedSchema>;

/**
 * 자식의 stdout에는 자격 정보가 있다. 메모리에서만 읽고 PIN은 반환하지 않는다.
 * `--with-pages`: 쪽 나눔 확인(V-08)용 웹툰·글 많은 A4·PDF 5쪽·소리를 더한다.
 */
export async function seedStudentExhibition(): Promise<SeededExhibition> {
  let stdout: string;
  try {
    ({ stdout } = await runFile(
      process.execPath,
      [
        'tools/dev/seed-exhibition.mjs',
        '--rooms',
        '2',
        '--per-room',
        '3',
        '--text',
        '1',
        '--with-pages',
        '--title',
        '학생 흐름 합성 전시',
      ],
      { cwd: ROOT, timeout: 210_000 },
    ));
  } catch {
    // execFile의 오류 객체에는 stdout이 붙으므로 원본 오류를 기록하지 않는다.
    throw new Error('개발 전시 시드 실행 실패. 자격 정보가 포함된 자식 출력은 기록하지 않았습니다.');
  }
  let wire: unknown;
  try {
    wire = JSON.parse(stdout);
  } catch {
    throw new Error('개발 전시 시드 응답이 JSON이 아닙니다.');
  }
  const parsed = SeedSchema.safeParse(wire);
  if (!parsed.success) throw new Error('개발 전시 시드 응답 형식이 올바르지 않습니다.');
  return parsed.data;
}

/** 교사 작업 화면 v3(G-32) 시험 전시: 전시실 5 · 그림 40(전시실마다 8). FIELD_PLAN HT-17 */
export const MANAGE_SEED = { rooms: 5, perRoom: 8, title: '교사 작업 화면 합성 전시' } as const;
const ManageSeedSchema = SeedSchema.extend({ pin: z.string().regex(/^\d+$/) });

export interface ManageSeed {
  readonly id: string;
  readonly title: string;
  readonly entryCode: string;
  readonly artworks: number;
  /** 시험 메모리에서만 보관한다(`enterTeacherPin`). 출력·첨부·storageState에 쓰지 않는다. */
  readonly pin: string;
  /** Node fetch로 교사 요청을 보낼 때만 쓴다. Playwright 호출에 넘기지 않는다. */
  readonly teacherToken: string;
}

/**
 * 끌어 놓기·지도·과업 누름 수를 재는 전시(5×8). 그림만 넣고 글·여러 쪽 자료는 넣지 않는다.
 * 자식의 stdout에는 자격 정보가 있으므로 메모리에서만 읽는다.
 */
export async function seedManageExhibition(): Promise<ManageSeed> {
  let stdout: string;
  try {
    ({ stdout } = await runFile(
      process.execPath,
      [
        'tools/dev/seed-exhibition.mjs',
        '--rooms',
        String(MANAGE_SEED.rooms),
        '--per-room',
        String(MANAGE_SEED.perRoom),
        '--text',
        '0',
        '--title',
        MANAGE_SEED.title,
      ],
      { cwd: ROOT, timeout: 420_000 },
    ));
  } catch {
    throw new Error('교사 작업 화면 시드 실행 실패. 자격 정보가 포함된 자식 출력은 기록하지 않았습니다.');
  }
  let wire: unknown;
  try {
    wire = JSON.parse(stdout);
  } catch {
    throw new Error('교사 작업 화면 시드 응답이 JSON이 아닙니다.');
  }
  const parsed = ManageSeedSchema.safeParse(wire);
  if (!parsed.success) throw new Error('교사 작업 화면 시드 응답 형식이 올바르지 않습니다.');
  const seed = parsed.data;
  if (seed.artworks !== MANAGE_SEED.rooms * MANAGE_SEED.perRoom)
    throw new Error(`교사 작업 화면 시드 작품 수가 다릅니다: ${seed.artworks}`);
  return {
    id: seed.exhibitionId,
    title: MANAGE_SEED.title,
    entryCode: seed.entryCode,
    artworks: seed.artworks,
    pin: seed.pin,
    teacherToken: seed.teacherToken,
  };
}

/** 교사 요청은 Node fetch로만 보낸다. Playwright API 호출 기록에 인증 머리를 남기지 않는다. */
async function requestData<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(config().API_TIMEOUT_MS),
  });
  const wire: unknown = await response.json();
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(wire);
    throw new Error(
      `개발 전시 요청 실패 (HTTP ${response.status}, ${error.success ? error.data.error.code : '응답 형식 불일치'})`,
    );
  }
  const parsed = okEnvelope(schema).safeParse(wire);
  if (!parsed.success) throw new Error('개발 전시 API 응답 형식이 올바르지 않습니다.');
  return parsed.data.data;
}

export const readStudentExhibition = (code: string) =>
  requestData(`/api/e/${EntryCodeSchema.parse(code)}`, ExhibitionViewSchema);

export async function closeStudentExhibition(seed: SeededExhibition): Promise<void> {
  const closed = await requestData(
    `/api/teacher/exhibitions/${seed.exhibitionId}/close`,
    ExhibitionTeacherSchema,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${seed.teacherToken}`, 'X-Device-Id': randomUUID() },
    },
  );
  if (closed.status !== 'CLOSED') throw new Error('개발 전시를 닫은 뒤 상태가 CLOSED가 아닙니다.');
}

/** DRAFT는 작품을 게시하거나 열지 않은 별도 합성 전시다. 원문 PIN·토큰은 이 함수 밖으로 내보내지 않는다. */
export async function createDraftExhibition(): Promise<string> {
  let pin: string;
  do {
    pin = Array.from({ length: config().PIN_MAX_LENGTH }, () => randomInt(0, 10)).join('');
  } while (isWeakPin(pin));
  const teacherToken = randomBytes(32).toString('base64url');
  const body = CreateExhibitionSchema.parse({
    exhibitionId: randomUUID(),
    title: '준비 중 합성 전시',
    templateId: 'modern-history',
    pin,
    linkTokenHash: createHash('sha256').update(teacherToken).digest('hex'),
  });
  const created = await requestData('/api/teacher/exhibitions', CreateExhibitionResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': randomUUID() },
    body: JSON.stringify(body),
  });
  return created.entryCode;
}
