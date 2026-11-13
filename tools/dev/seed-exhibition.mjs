#!/usr/bin/env node
// Node 24에서 실행한다. 자료 개수·그림 치수·색은 개발용 합성 fixture다.
// node tools/dev/seed-exhibition.mjs --rooms 3 --per-room 6 --text 1 --title "시험 근대 역사관"
// --text는 전시 전체 글 수, --per-room은 전시실마다 그림 수다. --save는 .local/dev/seed에만 저장한다.
// --with-pages는 쪽 나눔·여러 쪽·소리 확인용 합성 작품 4점(웹툰 800×20000, 글 많은 A4 2480×3508, PDF 5쪽, 짧은 사인파 WAV)을
// 전시실마다 돌아가며 더한다(V-08). 기본은 꺼짐 — 켜면 업로드·처리 시간이 늘어 다른 시험 시드는 그대로 둔다.
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
  withPages: z.boolean().default(false),
  save: z.boolean().default(false),
});
/** `--with-pages`가 더하는 작품 수(웹툰·A4·PDF·소리) */
export const PAGE_SET_SIZE = 4;
export const PDF_PAGE_COUNT = 5;
export const WEBTOON_SIZE = [800, 20_000];
export const A4_SIZE = [2480, 3508];
/** PDF 쪽은 기기가 긴 변 `PDF_RENDER_PX`로 그려 올린다(PLAN §5.3). 같은 A4 비율로 만든다 */
export const PDF_PAGE_SIZE = [
  Math.round((config().PDF_RENDER_PX * A4_SIZE[0]) / A4_SIZE[1]),
  config().PDF_RENDER_PX,
];
export const TONE_SECONDS = 2;
/**
 * 글 많은 A4의 줄 간격(원본 px). 데스크톱 1440×900의 쪽 상자(높이 약 660 CSS px)에 한 장으로 넣었을 때
 * 화면 줄 간격이 `READ_LINE_PITCH_MIN_PX`(18)를 넘는 값(약 96px 이상)이다 — PRD 15.1 "데스크톱에서는 한 장".
 * 300dpi 기준 약 8.8mm라 초등학생 손글씨·큰 글씨 보고서 크기다.
 */
export const A4_LINE_PITCH_PX = 104;
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
  const total = options.rooms * options.perRoom + options.text + (options.withPages ? PAGE_SET_SIZE : 0);
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
        'with-pages': { type: 'boolean', default: false },
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
      withPages: values['with-pages'],
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
  // 서버는 그림 모양으로 중복을 가린다(글자만 다른 그림은 같은 그림). 크기·색이 15장마다 되풀이되므로
  // 도형 자리도 번호마다 옮겨 21·30장 이상 만들어도 서로 다르게 한다.
  const shift = Math.floor(index / (sizes.length * colors.length));
  const rx = 100 + ((shift * 130) % 340);
  const cx = 650 - ((shift * 150) % 380);
  const cy = 420 + ((shift * 70) % 220);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
    <rect width="1000" height="1000" fill="#eee5d4"/>
    <rect x="${rx}" y="140" width="540" height="610" fill="${color}"/>
    <circle cx="${cx}" cy="${cy}" r="220" fill="#d6c6aa"/>
    <path d="M160 800 L500 440 L840 800 Z" fill="#3e5552"/>
    <text x="100" y="910" font-family="sans-serif" font-size="54" fill="#493f37">STUDY ${index + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 같은 씨앗이면 같은 수열(합성 그림을 실행마다 같게). 0 이상 1 미만 */
function sequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 가상 글 줄: 낱말 크기의 어두운 막대를 줄마다 채운다(글꼴에 기대지 않음). 문단 사이는 한 줄 비운다. */
function textLines({ left, right, top, bottom, pitch, glyph, seed, paragraph = 7, color = '#39332d' }) {
  const next = sequence(seed);
  const rects = [];
  let line = 0;
  for (let y = top; y + glyph <= bottom; y += pitch, line++) {
    if (paragraph > 0 && line % (paragraph + 1) === paragraph) continue;
    const end =
      line % (paragraph + 1) === paragraph - 1 ? left + (right - left) * (0.35 + next() * 0.4) : right;
    let x = left + (line % (paragraph + 1) === 0 ? glyph * 2 : 0);
    while (x < end) {
      const w = Math.round(glyph * (0.9 + next() * 3.4));
      if (x + w > end) break;
      rects.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${glyph}" rx="${Math.round(glyph / 6)}" fill="${color}"/>`,
      );
      x += w + Math.round(glyph * 0.6);
    }
  }
  return rects.join('');
}

/** 웹툰(긴 세로): 칸 그림 + 말풍선 속 가상 글 줄. 칸 사이 흰 여백은 쪽 경계 다듬기가 찾는 빈 줄이 된다 */
export async function generateWebtoon() {
  const [width, height] = WEBTOON_SIZE;
  const next = sequence(20_000);
  const colors = ['#a65f43', '#507a77', '#b28a42', '#676786', '#8b6951'];
  const parts = [`<rect width="${width}" height="${height}" fill="#fbf8f2"/>`];
  parts.push(
    `<text x="60" y="110" font-family="sans-serif" font-size="56" fill="#493f37">SYNTHETIC WEBTOON</text>`,
  );
  let y = 180;
  for (let panel = 0; y < height - 400; panel++) {
    const h = Math.min([1100, 1400, 900][panel % 3], height - 160 - y);
    const color = colors[panel % colors.length];
    const cx = 160 + Math.round(next() * 480);
    parts.push(
      `<rect x="40" y="${y}" width="${width - 80}" height="${h}" fill="#eee5d4" stroke="#3e3732" stroke-width="8"/>`,
      `<rect x="40" y="${y + h * 0.62}" width="${width - 80}" height="${h * 0.38}" fill="${color}"/>`,
      `<circle cx="${cx}" cy="${y + h * 0.5}" r="${Math.round(h * 0.16)}" fill="#d6c6aa"/>`,
      `<path d="M${cx - 120} ${y + h - 40} L${cx} ${y + h * 0.55} L${cx + 120} ${y + h - 40} Z" fill="#3e5552"/>`,
      `<ellipse cx="${width / 2}" cy="${y + 170}" rx="300" ry="120" fill="#ffffff" stroke="#3e3732" stroke-width="5"/>`,
      textLines({
        left: 230,
        right: 570,
        top: y + 110,
        bottom: y + 240,
        pitch: 44,
        glyph: 22,
        seed: panel + 1,
        paragraph: 0,
      }),
      `<text x="70" y="${y + h - 30}" font-family="sans-serif" font-size="36" fill="#f6f1e7">${panel + 1}</text>`,
    );
    y += h + 160;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 글 많은 A4 한 장(2480×3508): 제목 + 가상 글 줄이 촘촘한 본문 */
export async function generateTextDocument() {
  const [width, height] = A4_SIZE;
  const pitch = A4_LINE_PITCH_PX;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#fdfbf6"/>
    <text x="220" y="300" font-family="sans-serif" font-size="96" fill="#2f2a25">SYNTHETIC REPORT</text>
    ${textLines({ left: 220, right: width - 220, top: 440, bottom: height - 240, pitch, glyph: Math.round(pitch * 0.38), seed: 3508 })}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** PDF 한 쪽을 기기가 그린 모양(A4 비율 PNG). 쪽마다 머리 번호·그림 칸·글 줄이 달라 내용이 겹치지 않는다 */
export async function generatePdfPage(index) {
  CountSchema.parse(index);
  const [width, height] = PDF_PAGE_SIZE;
  const colors = ['#a65f43', '#507a77', '#b28a42', '#676786', '#8b6951'];
  const figure = 360 + (index % 3) * 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#fdfbf6"/>
    <text x="150" y="210" font-family="sans-serif" font-size="64" fill="#2f2a25">SYNTHETIC PAGE ${index + 1}</text>
    <rect x="150" y="300" width="${width - 300}" height="${figure}" fill="${colors[index % colors.length]}"/>
    <circle cx="${300 + index * 220}" cy="${300 + figure / 2}" r="${figure / 3}" fill="#d6c6aa"/>
    ${textLines({ left: 150, right: width - 150, top: 360 + figure, bottom: height - 200, pitch: 70, glyph: 34, seed: 101 + index })}
    <text x="${width / 2 - 40}" y="${height - 90}" font-family="sans-serif" font-size="44" fill="#6b625a">${index + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 짧은 합성 사인파 WAV(16bit 모노 44.1kHz, 앞뒤 짧게 키우고 줄임) */
export function generateTone(seconds = TONE_SECONDS, { frequency = 440, sampleRate = 44_100 } = {}) {
  const samples = Math.round(seconds * sampleRate);
  const fade = Math.round(sampleRate * 0.05);
  const output = Buffer.alloc(44 + samples * 2);
  output.write('RIFF', 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / fade, (samples - 1 - i) / fade);
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.3 * envelope;
    output.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return output;
}

/** `--with-pages` 작품 자료 한 벌 */
export async function generatePageMedia() {
  const pdfPages = [];
  for (let index = 0; index < PDF_PAGE_COUNT; index++) pdfPages.push(await generatePdfPage(index));
  return {
    webtoon: await generateWebtoon(),
    document: await generateTextDocument(),
    pdfPages,
    tone: generateTone(),
  };
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
  {
    fetchImpl = globalThis.fetch,
    createImage = generateImage,
    createPageMedia = generatePageMedia,
    sleep = setTimeout,
    now = Date.now,
  } = {},
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

  /** schema가 null이면 본문 없는 204만 받는다(PDF 쪽 올리기). */
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
    if (schema === null && response.status === 204) return null;
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
    if (schema === null) throw new SeedError(stage, 'E_SERVER', { httpStatus: response.status });
    const parsed = okEnvelope(schema).safeParse(wire);
    if (!parsed.success) throw new SeedError(stage, 'E_SERVER', { httpStatus: response.status });
    return parsed.data.data;
  }

  async function uploadFile(meta, bytes, type, filename) {
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    form.set('file', new Blob([bytes], { type }), filename);
    const art = await request('POST', `${base}/artworks`, ArtworkStateSchema, { body: form, upload: true });
    if (art.id !== meta.id) throw new SeedError(stage, 'E_SERVER');
    return art.id;
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
        stage = `그림 올리기 ${index + 1}`;
        const meta = { id: randomUUID(), roomId, order, title: `합성 도형 ${index + 1}`, kind: 'IMAGE' };
        artworkIds.push(await uploadFile(meta, image, 'image/png', `synthetic-${index + 1}.png`));
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

    const kinds = { IMAGE: artworkIds.length - options.text, TEXT: options.text, PDF: 0, AUDIO: 0 };
    if (options.withPages) {
      stage = '쪽 나눔 자료 만들기';
      const media = await createPageMedia();
      // 글 다음 자리부터 전시실마다 돌아가며 놓는다.
      const firstOrder = options.perRoom + Math.ceil(options.text / rooms.length);
      let slot = 0;
      const place = () => {
        const at = slot++;
        return { roomId: rooms[at % rooms.length], order: firstOrder + Math.floor(at / rooms.length) };
      };
      stage = '웹툰 올리기';
      const webtoon = { id: randomUUID(), ...place(), title: '합성 웹툰 긴 이야기', kind: 'IMAGE' };
      artworkIds.push(await uploadFile(webtoon, media.webtoon, 'image/png', 'synthetic-webtoon.png'));
      stage = '글 많은 A4 올리기';
      const report = { id: randomUUID(), ...place(), title: '합성 보고서 한 장', kind: 'IMAGE' };
      artworkIds.push(await uploadFile(report, media.document, 'image/png', 'synthetic-report-a4.png'));
      kinds.IMAGE += 2;

      stage = 'PDF 만들기';
      const pdfId = randomUUID();
      const pdf = await request('POST', `${base}/artworks`, ArtworkStateSchema, {
        body: {
          id: pdfId,
          ...place(),
          kind: 'PDF',
          title: '합성 여러 쪽 문서',
          pageCount: media.pdfPages.length,
        },
      });
      if (pdf.id !== pdfId) throw new SeedError(stage, 'E_SERVER');
      for (const [index, page] of media.pdfPages.entries()) {
        stage = `PDF 쪽 올리기 ${index + 1}`;
        const form = new FormData();
        form.set('file', new Blob([page], { type: 'image/png' }), `synthetic-page-${index + 1}.png`);
        await request('PUT', `/api/teacher/artworks/${pdfId}/pages/${index + 1}`, null, {
          body: form,
          upload: true,
        });
      }
      stage = 'PDF 마치기';
      const done = await request('POST', `/api/teacher/artworks/${pdfId}/complete`, ArtworkStateSchema);
      if (done.id !== pdfId) throw new SeedError(stage, 'E_SERVER');
      artworkIds.push(pdfId);
      kinds.PDF += 1;

      stage = '소리 올리기';
      const tone = { id: randomUUID(), ...place(), title: '합성 소리 라 음', kind: 'AUDIO' };
      artworkIds.push(await uploadFile(tone, media.tone, 'audio/wav', 'synthetic-tone.wav'));
      kinds.AUDIO += 1;
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
    return {
      exhibitionId,
      entryCode: created.entryCode,
      teacherToken,
      pin,
      artworks: artworkIds.length,
      kinds,
    };
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
