#!/usr/bin/env node
// Node 24에서 실행한다. 자료 개수·그림 치수·색은 개발용 합성 fixture다.
// node tools/dev/seed-exhibition.mjs --rooms 3 --per-room 6 --text 1 --title "시험 근대 역사관"
// --text는 전시 전체 글 수, --per-room은 전시실마다 그림 수다. --save는 .local/dev/seed에만 저장한다.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { z } from 'zod';
import { isWeakPin } from '../../apps/server/src/security/pin.ts';
import { config } from '../../packages/core/src/config.ts';
import { okEnvelope, ApiErrorSchema } from '../../packages/core/src/types/api.ts';
import { ArtworkTeacherSchema } from '../../packages/core/src/types/artwork.ts';
import {
  CreateExhibitionSchema,
  CreateExhibitionResultSchema,
  ExhibitionTeacherSchema,
} from '../../packages/core/src/types/exhibition.ts';
import { RoomTeacherSchema } from '../../packages/core/src/types/room.ts';

const DEV_ORIGIN = 'http://127.0.0.1:4521';
const DEFAULTS = { baseUrl: DEV_ORIGIN, rooms: 3, perRoom: 6, text: 1, title: '합성 그림 시험 전시' };
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const OptionsSchema = z.object({
  baseUrl: z.string().default(DEFAULTS.baseUrl),
  rooms: CountSchema.positive().default(DEFAULTS.rooms),
  perRoom: CountSchema.default(DEFAULTS.perRoom),
  text: CountSchema.default(DEFAULTS.text),
  title: CreateExhibitionSchema.shape.title.default(DEFAULTS.title),
  save: z.boolean().default(false),
});
const ArtworkStateSchema = ArtworkTeacherSchema.pick({ id: true, status: true, failCode: true });
const ArtworkStatesSchema = z.object({ artworks: z.array(ArtworkStateSchema) });
const OpenSchema = ExhibitionTeacherSchema.pick({ id: true, status: true });
const BatchSchema = z.object({ changed: CountSchema });

class SeedError extends Error {
  constructor(stage, code, { httpStatus, exhibitionId } = {}) {
    super(`${stage} (${code})`);
    this.stage = stage;
    this.code = code;
    this.httpStatus = httpStatus;
    this.exhibitionId = exhibitionId;
  }
}

// URL 정규화가 127.1·정수 IP·앞뒤 공백 등을 허용하지 않도록 원문도 제한한다.
export function validateTarget(target) {
  if (target !== DEV_ORIGIN && target !== `${DEV_ORIGIN}/`)
    throw new SeedError('대상 주소 검사', 'E_VALIDATION');
  return DEV_ORIGIN;
}

function validateOptions(input) {
  const parsed = OptionsSchema.safeParse(input);
  if (!parsed.success) throw new SeedError('옵션 검사', 'E_VALIDATION');
  const options = parsed.data;
  validateTarget(options.baseUrl);
  const total = options.rooms * options.perRoom + options.text;
  if (!Number.isSafeInteger(total) || total === 0) throw new SeedError('옵션 검사', 'E_VALIDATION');
  return options;
}

export function parseOptions(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        'base-url': { type: 'string' },
        rooms: { type: 'string' },
        'per-room': { type: 'string' },
        text: { type: 'string' },
        title: { type: 'string' },
        save: { type: 'boolean', default: false },
      },
    });
    const count = value => {
      if (value === undefined) return undefined;
      if (!/^\d+$/.test(value)) throw new SeedError('옵션 검사', 'E_VALIDATION');
      return Number(value);
    };
    return validateOptions({
      baseUrl: values['base-url'],
      rooms: count(values.rooms),
      perRoom: count(values['per-room']),
      text: count(values.text),
      title: values.title,
      save: values.save,
    });
  } catch (error) {
    if (error instanceof SeedError) throw error;
    throw new SeedError('옵션 검사', 'E_VALIDATION');
  }
}

export async function generateImage(index) {
  CountSchema.parse(index);
  const sizes = [
    [2400, 1600],
    [1600, 2400],
    [1600, 1600],
  ];
  const colors = ['#a65f43', '#507a77', '#b28a42', '#676786', '#8b6951'];
  const [width, height] = sizes[index % sizes.length];
  const color = colors[index % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 1000">
    <rect width="1000" height="1000" fill="#eee5d4"/>
    <rect x="100" y="140" width="540" height="610" fill="${color}"/>
    <circle cx="650" cy="420" r="220" fill="#d6c6aa"/>
    <path d="M160 800 L500 440 L840 800 Z" fill="#3e5552"/>
    <text x="100" y="910" font-family="sans-serif" font-size="54" fill="#493f37">STUDY ${index + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function newPin() {
  let pin;
  do {
    pin = Array.from({ length: config().PIN_MAX_LENGTH }, () => randomInt(0, 10)).join('');
  } while (isWeakPin(pin));
  return pin;
}

export async function seedExhibition(
  input = {},
  { fetchImpl = globalThis.fetch, createImage = generateImage, sleep = setTimeout, now = Date.now } = {},
) {
  const options = validateOptions(input);
  const baseUrl = validateTarget(options.baseUrl);
  const exhibitionId = randomUUID();
  const teacherToken = randomBytes(32).toString('base64url');
  const pin = newPin();
  const deviceId = randomUUID();
  const cfg = config();
  const processingTimeoutMs = cfg.UPLOAD_IDLE_TIMEOUT_SEC * 1000;
  const uploadTimeoutMs = processingTimeoutMs + cfg.TOOL_TIMEOUT_MS;
  const base = `/api/teacher/exhibitions/${exhibitionId}`;
  let stage = '전시 만들기';

  async function request(method, path, schema, { body, authenticate = true, upload = false } = {}) {
    const headers = new Headers({ 'X-Device-Id': deviceId });
    if (authenticate) headers.set('Authorization', `Bearer ${teacherToken}`);
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        // 허용된 개발 주소가 다른 포트·호스트로 돌려보내도 따라가지 않는다.
        redirect: 'error',
        signal: AbortSignal.timeout(upload ? uploadTimeoutMs : cfg.API_TIMEOUT_MS),
      });
    } catch {
      throw new SeedError(stage, 'E_OFFLINE');
    }
    let wire;
    try {
      wire = await response.json();
    } catch {
      throw new SeedError(stage, 'E_SERVER', { httpStatus: response.status });
    }
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(wire);
      throw new SeedError(stage, error.success ? error.data.error.code : 'E_SERVER', {
        httpStatus: response.status,
      });
    }
    const parsed = okEnvelope(schema).safeParse(wire);
    if (!parsed.success) throw new SeedError(stage, 'E_SERVER', { httpStatus: response.status });
    return parsed.data.data;
  }

  try {
    const created = await request('POST', '/api/teacher/exhibitions', CreateExhibitionResultSchema, {
      authenticate: false,
      body: {
        exhibitionId,
        title: options.title,
        templateId: 'modern-history',
        pin,
        linkTokenHash: createHash('sha256').update(teacherToken).digest('hex'),
      },
    });
    if (created.exhibitionId !== exhibitionId) throw new SeedError(stage, 'E_SERVER');

    const rooms = [];
    stage = '전시실 만들기';
    for (let order = 0; order < options.rooms; order++) {
      const id = randomUUID();
      const room = await request('POST', `${base}/rooms`, RoomTeacherSchema.pick({ id: true }), {
        body: { id, order, title: `합성 전시실 ${order + 1}` },
      });
      if (room.id !== id) throw new SeedError(stage, 'E_SERVER');
      rooms.push(id);
    }

    const artworkIds = [];
    for (const roomId of rooms) {
      for (let order = 0; order < options.perRoom; order++) {
        const index = artworkIds.length;
        stage = `합성 그림 만들기 ${index + 1}`;
        const image = await createImage(index);
        const id = randomUUID();
        const form = new FormData();
        form.set(
          'meta',
          JSON.stringify({ id, roomId, order, title: `합성 도형 ${index + 1}`, kind: 'IMAGE' }),
        );
        form.set('file', new Blob([image], { type: 'image/png' }), `synthetic-${index + 1}.png`);
        stage = `그림 올리기 ${index + 1}`;
        const art = await request('POST', `${base}/artworks`, ArtworkStateSchema, {
          body: form,
          upload: true,
        });
        if (art.id !== id) throw new SeedError(stage, 'E_SERVER');
        artworkIds.push(id);
      }
    }

    for (let index = 0; index < options.text; index++) {
      stage = `글 만들기 ${index + 1}`;
      const id = randomUUID();
      const art = await request('POST', `${base}/artworks`, ArtworkStateSchema, {
        body: {
          id,
          roomId: rooms[index % rooms.length],
          order: options.perRoom + Math.floor(index / rooms.length),
          kind: 'TEXT',
          title: `상상 기록 ${index + 1}`,
          textBody: `상상 속 마을의 기록 ${index + 1}\n네모난 창으로 햇빛이 들어왔습니다.\n둥근 돌 옆에 작은 길을 그렸습니다.`,
        },
      });
      if (art.id !== id) throw new SeedError(stage, 'E_SERVER');
      artworkIds.push(id);
    }

    stage = '작품 처리 대기';
    const deadline = now() + processingTimeoutMs;
    while (true) {
      const view = await request('GET', base, ArtworkStatesSchema);
      const byId = new Map(view.artworks.map(art => [art.id, art]));
      const artworks = artworkIds.map(id => byId.get(id));
      if (artworks.some(art => art === undefined)) throw new SeedError(stage, 'E_SERVER');
      const failed = artworks.find(art => art.status === 'FAILED');
      if (failed) throw new SeedError(stage, failed.failCode ?? 'E_SERVER');
      if (artworks.every(art => art.status !== 'PROCESSING')) break;
      if (now() >= deadline) throw new SeedError(stage, 'E_BUSY');
      await sleep(Math.min(cfg.LIVE_RETRY_MIN_MS, deadline - now()));
    }

    stage = '작품 게시';
    await request('POST', '/api/teacher/artworks/batch', BatchSchema, {
      body: { action: 'PUBLISH', ids: artworkIds },
    });
    stage = '전시 열기';
    const opened = await request('POST', `${base}/open`, OpenSchema);
    if (opened.id !== exhibitionId || opened.status !== 'OPEN') throw new SeedError(stage, 'E_SERVER');
    return { exhibitionId, entryCode: created.entryCode, teacherToken, pin, artworks: artworkIds.length };
  } catch (error) {
    const failure = error instanceof SeedError ? error : new SeedError(stage, 'E_SERVER');
    failure.exhibitionId = exhibitionId;
    throw failure;
  }
}

async function main() {
  let stage = '옵션 검사';
  let result;
  try {
    const options = parseOptions(process.argv.slice(2));
    result = await seedExhibition(options);
    if (options.save) {
      stage = '개발 자격 저장';
      const directory = resolve(ROOT, '.local/dev/seed');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(resolve(directory, `${result.entryCode}.json`), `${JSON.stringify(result)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const failure = error instanceof SeedError ? error : new SeedError(stage, 'E_SERVER');
    process.stderr.write(
      `${JSON.stringify({
        stage: failure.stage,
        code: failure.code,
        httpStatus: failure.httpStatus,
        exhibitionId: failure.exhibitionId ?? result?.exhibitionId,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
