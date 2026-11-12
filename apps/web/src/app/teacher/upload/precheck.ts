import { config } from '@gallery/core/config';
import type { FileKind } from '@gallery/core/classify';
import type { ErrorCode } from '@gallery/core/errors';
import { charCount, normalizeText } from '@gallery/core/types';
import { countPdfPages, pdfjsEngine, type PdfEngine } from './pdfPages.ts';

/**
 * 기기 사전 검사(PLAN §5.3, PRD 6.3). 올리기 전에 바로 알려 주고 학교 업로드 대역을 아낀다 — 안전은 서버 검사(§9.4)가 맡는다.
 *
 * - 형식: 확장자(`fileKindFromName`)로 가른 뒤 첫 바이트로 다시 본다. 확장자가 그림인데 첫 바이트가 영상이면 영상 안내(G-23).
 * - 그림 치수는 머리만 읽는다(전체를 풀지 않음). JPEG의 SOF가 앞 `HEAD_BYTES` 안에 없으면(큰 EXIF 썸네일) 서버에 맡긴다.
 * - HEIC는 형식·크기만(치수는 서버가 `sips`로 바꾼 뒤).
 * - PDF는 크기(문서 25MB)·첫 바이트(`%PDF-`)를 본 뒤 pdf.js로 쪽 수만 센다(`PDF_MAX_PAGES` 초과는 `E_PDF_PAGES`).
 *   암호가 걸렸거나 열 수 없으면 `E_FILE_BROKEN`. 쪽 그림은 올리기 줄이 차례가 왔을 때 만든다(`pdfPages.ts`).
 * - 소리 길이는 미디어 요소로 잰다. 기기가 길이를 못 읽으면 막지 않고 서버에 맡긴다(M4A·WAV를 못 읽는 기기에서 헛막힘 방지).
 * - 내용 해시(SHA-256)는 같은 파일을 두 번 놓았을 때 두 번째를 올리지 않으려고 만든다(PLAN §5.2).
 */

/** 막힘·실패 사유(오류 코드) */
export type UploadProblem = ErrorCode;

export type PrecheckKind = 'IMAGE' | 'AUDIO' | 'TEXT' | 'PDF';

export type PrecheckResult =
  | {
      readonly ok: true;
      readonly kind: PrecheckKind;
      /** 흐림 경고(짧은 변 < `WARN_SHORT_SIDE_PX`) — 올리기는 한다 */
      readonly lowRes: boolean;
      /**
       * 내용 SHA-256(16진 소문자). 이 기기에서 만들 수 없으면 null — 보안 연결이 아닌 `http`(LAN 개발 주소)에는
       * `crypto.subtle`이 없다. 그때는 기기 쪽 중복 거르기만 건너뛰고 서버가 거른다(`E_DUPLICATE`)
       */
      readonly hash: string | null;
      /** 글 파일이면 정규화한 본문 */
      readonly text: string | null;
      /** PDF면 쪽 수 */
      readonly pageCount?: number;
    }
  | { readonly ok: false; readonly problem: UploadProblem };

export interface PrecheckDeps {
  /** 소리 길이(ms). 못 읽으면 null. 기본은 `<audio>`의 `loadedmetadata` */
  readonly audioDurationMs?: (file: Blob) => Promise<number | null>;
  /** 내용 해시. 기본 `crypto.subtle` */
  readonly sha256Hex?: (file: Blob) => Promise<string | null>;
  /** PDF 엔진(쪽 세기). 기본은 pdf.js를 그때 받는다 */
  readonly pdf?: () => Promise<PdfEngine>;
}

/** 머리로 읽는 앞부분(JPEG SOF가 EXIF 뒤에 와도 대개 이 안) */
const HEAD_BYTES = config().UPLOAD_HEAD_BYTES;
const BYTES_PER_MB = 1024 * 1024;
const MS_PER_MIN = 60_000;
/** 소리 길이를 기다리는 한도(못 읽으면 서버에 맡김) */
const AUDIO_PROBE_TIMEOUT_MS = config().AUDIO_PROBE_TIMEOUT_MS;

type Sniffed = 'PNG' | 'JPEG' | 'GIF' | 'WEBP' | 'HEIC' | 'MP3' | 'M4A' | 'WAV' | 'PDF' | 'VIDEO' | 'SVG';

const ascii = (b: Uint8Array, start: number, len: number): string =>
  String.fromCharCode(...b.subarray(start, start + len));

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif']);
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'mp42', 'isom', 'dash']);
const VIDEO_BRANDS = new Set([
  'qt  ',
  'mp41',
  'avc1',
  'M4V ',
  'M4VH',
  'M4VP',
  '3gp4',
  '3gp5',
  '3g2a',
  'crx ',
]);

/** 첫 바이트로 형식을 가른다(모르면 null) */
export const sniff = (b: Uint8Array): Sniffed | null => {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'PNG';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
  if (ascii(b, 0, 4) === 'GIF8') return 'GIF';
  if (ascii(b, 0, 4) === 'RIFF') {
    const tag = ascii(b, 8, 4);
    if (tag === 'WEBP') return 'WEBP';
    if (tag === 'WAVE') return 'WAV';
    if (tag === 'AVI ') return 'VIDEO';
  }
  if (ascii(b, 0, 5) === '%PDF-') return 'PDF';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (HEIC_BRANDS.has(brand)) return 'HEIC';
    if (VIDEO_BRANDS.has(brand)) return 'VIDEO';
    if (AUDIO_BRANDS.has(brand)) return 'M4A';
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'VIDEO';
  if (ascii(b, 0, 3) === 'ID3') return 'MP3';
  if (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) return 'MP3';
  const lead = new TextDecoder().decode(b.subarray(0, 256)).trimStart().toLowerCase();
  if (lead.startsWith('<svg') || (lead.startsWith('<?xml') && lead.includes('<svg'))) return 'SVG';
  return null;
};

const IMAGE_SNIFFS: ReadonlySet<Sniffed> = new Set(['PNG', 'JPEG', 'GIF', 'WEBP', 'HEIC']);
const AUDIO_SNIFFS: ReadonlySet<Sniffed> = new Set(['MP3', 'M4A', 'WAV']);

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 0x10000 + u16be(b, i + 2);

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpegSize = (b: Uint8Array): { w: number; h: number } | null => {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // 길이 없는 표지(RST·SOI·TEM)
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    if (JPEG_SOF.has(marker)) return { h: u16be(b, i + 5), w: u16be(b, i + 7) };
    i += 2 + len;
  }
  return null;
};

const webpSize = (b: Uint8Array): { w: number; h: number } | null => {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  return null;
};

/** 머리에서 그림 치수(못 찾으면 null) */
export const imageSize = (kind: Sniffed, b: Uint8Array): { w: number; h: number } | null => {
  switch (kind) {
    case 'PNG':
      return b.length >= 24 && ascii(b, 12, 4) === 'IHDR' ? { w: u32be(b, 16), h: u32be(b, 20) } : null;
    case 'GIF':
      return b.length >= 10 ? { w: u16le(b, 6), h: u16le(b, 8) } : null;
    case 'WEBP':
      return webpSize(b);
    case 'JPEG':
      return jpegSize(b);
    default:
      return null;
  }
};

const defaultSha256 = async (file: Blob): Promise<string | null> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
};

const defaultAudioDuration = (file: Blob): Promise<number | null> =>
  new Promise(resolve => {
    if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const finish = (ms: number | null) => {
      clearTimeout(timer);
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const timer = setTimeout(() => finish(null), AUDIO_PROBE_TIMEOUT_MS);
    el.preload = 'metadata';
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration * 1000 : null);
    el.onerror = () => finish(null);
    el.src = url;
  });

const blocked = (problem: UploadProblem): PrecheckResult => ({ ok: false, problem });

const readHead = async (file: Blob): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  } catch {
    return null;
  }
};

/**
 * 파일 하나 검사. `kind`는 폴더 규칙이 확장자로 가른 종류(`UploadItem.kind`).
 * 막히면 `{ok:false, problem}`(카드에 그 문구 한 줄), 통과하면 해시·흐림 경고·글 본문.
 */
export const precheckFile = async (
  file: Blob,
  kind: FileKind,
  deps: PrecheckDeps = {},
): Promise<PrecheckResult> => {
  const cfg = config();
  if (kind === 'VIDEO') return blocked('E_VIDEO_UNSUPPORTED');
  if (kind === 'OTHER') return blocked('E_FILE_TYPE');
  const limitMb = kind === 'AUDIO' ? cfg.MAX_AUDIO_MB : cfg.MAX_IMAGE_MB;
  if (file.size > limitMb * BYTES_PER_MB) return blocked('E_FILE_TOO_LARGE');
  if (file.size === 0) return blocked('E_FILE_BROKEN');

  const head = await readHead(file);
  if (head === null) return blocked('E_FILE_BROKEN');
  const sniffed = sniff(head);
  if (sniffed === 'VIDEO') return blocked('E_VIDEO_UNSUPPORTED');
  if (sniffed === 'SVG') return blocked('E_FILE_TYPE');

  let lowRes = false;
  let text: string | null = null;
  let pageCount: number | null = null;
  let finalKind: PrecheckKind;

  if (kind === 'PDF') {
    if (sniffed !== 'PDF')
      return blocked(
        sniffed !== null && (IMAGE_SNIFFS.has(sniffed) || AUDIO_SNIFFS.has(sniffed))
          ? 'E_FILE_TYPE'
          : 'E_FILE_BROKEN',
      );
    let engine: PdfEngine;
    try {
      engine = await (deps.pdf ?? pdfjsEngine)();
    } catch {
      // pdf.js를 받지 못함(연결 끊김) — 파일 탓이 아니다
      return blocked('E_OFFLINE');
    }
    const pages = await countPdfPages(file, engine);
    if (pages === null || pages < 1) return blocked('E_FILE_BROKEN');
    if (pages > cfg.PDF_MAX_PAGES) return blocked('E_PDF_PAGES');
    pageCount = pages;
    finalKind = 'PDF';
  } else if (kind === 'TEXT') {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      return blocked('E_FILE_BROKEN');
    }
    text = normalizeText(decoded.replace(/^﻿/, ''));
    if (charCount(text) === 0) return blocked('E_FILE_BROKEN');
    if (charCount(text) > cfg.TEXT_MAX_CHARS) return blocked('E_TEXT_LENGTH');
    finalKind = 'TEXT';
  } else if (kind === 'IMAGE') {
    if (sniffed === null || !IMAGE_SNIFFS.has(sniffed))
      return blocked(sniffed !== null && AUDIO_SNIFFS.has(sniffed) ? 'E_FILE_TYPE' : 'E_FILE_BROKEN');
    if (sniffed !== 'HEIC') {
      const size = imageSize(sniffed, head);
      if (size === null || size.w === 0 || size.h === 0) {
        // JPEG는 SOF가 머리 밖에 있을 수 있다 — 서버가 다시 본다
        if (sniffed !== 'JPEG') return blocked('E_FILE_BROKEN');
      } else {
        const short = Math.min(size.w, size.h);
        const long = Math.max(size.w, size.h);
        if (short < cfg.MIN_SHORT_SIDE_PX) return blocked('E_FILE_TOO_SMALL');
        if (long / short > cfg.MAX_ASPECT) return blocked('E_ASPECT');
        lowRes = short < cfg.WARN_SHORT_SIDE_PX;
      }
    }
    finalKind = 'IMAGE';
  } else {
    if (sniffed === null || !AUDIO_SNIFFS.has(sniffed))
      return blocked(sniffed !== null && IMAGE_SNIFFS.has(sniffed) ? 'E_FILE_TYPE' : 'E_FILE_BROKEN');
    const ms = await (deps.audioDurationMs ?? defaultAudioDuration)(file);
    if (ms !== null && ms > cfg.AUDIO_MAX_MIN * MS_PER_MIN) return blocked('E_AUDIO_LENGTH');
    finalKind = 'AUDIO';
  }

  let hash: string | null;
  try {
    hash = await (deps.sha256Hex ?? defaultSha256)(file);
  } catch {
    return blocked('E_FILE_BROKEN');
  }
  return pageCount === null
    ? { ok: true, kind: finalKind, lowRes, hash, text }
    : { ok: true, kind: finalKind, lowRes, hash, text, pageCount };
};
