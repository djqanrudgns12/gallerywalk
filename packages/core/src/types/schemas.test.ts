import { afterEach, describe, expect, it } from 'vitest';
import { overrideConfig, resetConfig } from '../config.ts';
import {
  ApiErrorSchema,
  ArtworkBatchSchema,
  CreateExhibitionSchema,
  CreateJsonArtworkSchema,
  EntryCodeSchema,
  ExhibitionSettingsSchema,
  LayoutSchema,
  LiveClientMessageSchema,
  LiveServerMessageSchema,
  PatchArtworkSchema,
  PinSchema,
  ReactionBodySchema,
  VisitorRegisterSchema,
  anythingPublic,
  decodeBase64,
  decodeImageAnalysis,
  issueFields,
  mediaPath,
  okEnvelope,
  type Layout,
} from './index.ts';
import { z } from 'zod';

const ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ID2 = '9a8b7c6d-5e4f-4321-8fed-cba987654321';
const HASH = 'a'.repeat(64);

afterEach(() => resetConfig());

describe('전시 설정 기본값(PRD G-07·G-16 표)', () => {
  it('빈 객체 → 표의 기본값', () => {
    const s = ExhibitionSettingsSchema.parse({});
    expect(s.reactions).toEqual({
      enabled: true,
      collect: { sticker: true, memo: true, score: false },
      naming: 'NICKNAME',
      stickerVisibility: 'TEACHER',
      memoVisibility: 'TEACHER',
      scoreVisibility: 'TEACHER',
    });
    expect(s.tour).toEqual({ timeMode: 'MUSIC', secondsPerRoom: 40 });
    expect(anythingPublic(s.reactions)).toBe(false);
  });

  it('일부만 주면 나머지는 기본값', () => {
    const s = ExhibitionSettingsSchema.parse({
      reactions: { collect: { score: true }, scoreVisibility: 'PUBLIC' },
    });
    expect(s.reactions.collect).toEqual({ sticker: true, memo: true, score: true });
    expect(anythingPublic(s.reactions)).toBe(true);
  });

  it('반응을 켰는데 받을 것이 하나도 없으면 거절', () => {
    const r = ExhibitionSettingsSchema.safeParse({
      reactions: { collect: { sticker: false, memo: false, score: false } },
    });
    expect(r.success).toBe(false);
    expect(issueFields(r.error!)).toEqual({ 'reactions.collect': 'nothing_collected' });
  });

  it('투어 시간은 설정 범위 안', () => {
    expect(ExhibitionSettingsSchema.safeParse({ tour: { secondsPerRoom: 19 } }).success).toBe(false);
    expect(ExhibitionSettingsSchema.safeParse({ tour: { secondsPerRoom: 361 } }).success).toBe(false);
    expect(ExhibitionSettingsSchema.parse({ tour: { timeMode: 'FIXED', secondsPerRoom: 60 } }).tour).toEqual({
      timeMode: 'FIXED',
      secondsPerRoom: 60,
    });
  });
});

describe('글 칸: 정규화와 길이(설정에서 그때그때 읽음)', () => {
  const create = (title: string) =>
    CreateExhibitionSchema.safeParse({
      exhibitionId: ID,
      title,
      templateId: 'modern-history',
      pin: '482910',
      linkTokenHash: HASH,
    });

  it('한 줄 글은 줄바꿈·겹친 공백을 하나로, 앞뒤 공백 제거', () => {
    const r = create('  S.O.S.\n  연대기   전시관 ');
    expect(r.success && r.data.title).toBe('S.O.S. 연대기 전시관');
  });

  it('비면 required, 넘으면 too_long — 한도는 config를 바꾸면 바로 따라감', () => {
    expect(issueFields(create('   ').error!)).toEqual({ title: 'required' });
    expect(create('가'.repeat(40)).success).toBe(true);
    expect(issueFields(create('가'.repeat(41)).error!)).toEqual({ title: 'too_long' });
    overrideConfig({ EXHIBITION_TITLE_MAX_CHARS: 50 });
    expect(create('가'.repeat(41)).success).toBe(true);
  });

  it('글 작품 본문은 여러 줄: CRLF → LF, 가운데 빈 줄(문단)은 남김, 5,000자 한도', () => {
    const base = { id: ID, roomId: ID2, order: 0, title: '', kind: 'TEXT' } as const;
    const ok = CreateJsonArtworkSchema.parse({ ...base, textBody: '\r\n첫 줄  \r\n\r\n둘째 문단\r\n' });
    expect(ok.kind === 'TEXT' && ok.textBody).toBe('첫 줄\n\n둘째 문단');
    expect(CreateJsonArtworkSchema.safeParse({ ...base, textBody: '가'.repeat(5001) }).success).toBe(false);
    expect(CreateJsonArtworkSchema.safeParse({ ...base, textBody: ' \n ' }).success).toBe(false);
  });

  it('비울 수 있는 칸은 빈 글이면 null', () => {
    const p = PatchArtworkSchema.parse({ author: '   ', caption: null });
    expect(p).toEqual({ author: null, caption: null });
  });
});

describe('코드와 PIN', () => {
  it('입장 코드는 숫자 6자리(앞자리 0 허용)', () => {
    expect(EntryCodeSchema.safeParse('012345').success).toBe(true);
    expect(EntryCodeSchema.safeParse('12345').success).toBe(false);
    expect(EntryCodeSchema.safeParse('01234a').success).toBe(false);
  });

  it('PIN은 숫자 6~8자리(ADR-024)', () => {
    expect(PinSchema.safeParse('48291').success).toBe(false);
    expect(PinSchema.safeParse('482910').success).toBe(true);
    expect(PinSchema.safeParse('48291077').success).toBe(true);
    expect(PinSchema.safeParse('482910771').success).toBe(false);
    expect(PinSchema.safeParse('4829 10').success).toBe(false);
  });
});

describe('작품 요청 본문', () => {
  it('PDF는 쪽 수가 PDF_MAX_PAGES 이하', () => {
    const base = { id: ID, roomId: ID2, order: 3, title: '의병 기록첩', kind: 'PDF' } as const;
    expect(CreateJsonArtworkSchema.safeParse({ ...base, pageCount: 30 }).success).toBe(true);
    expect(CreateJsonArtworkSchema.safeParse({ ...base, pageCount: 31 }).success).toBe(false);
  });

  it('모르는 칸·빈 고치기는 거절', () => {
    expect(PatchArtworkSchema.safeParse({}).success).toBe(false);
    expect(PatchArtworkSchema.safeParse({ title: '새 제목', rogue: 1 }).success).toBe(false);
    expect(PatchArtworkSchema.safeParse({ status: 'FAILED' }).success).toBe(false);
  });

  it('여러 개 옮기기는 전시실이 있어야 하고 ID가 겹치면 안 됨', () => {
    expect(ArtworkBatchSchema.safeParse({ action: 'MOVE', ids: [ID] }).success).toBe(false);
    expect(ArtworkBatchSchema.safeParse({ action: 'MOVE', ids: [ID], roomId: ID2 }).success).toBe(true);
    expect(ArtworkBatchSchema.safeParse({ action: 'HIDE', ids: [ID, ID] }).success).toBe(false);
  });
});

describe('반응', () => {
  const none = { sticker: null, memo: null, scoreFact: null, scoreDelivery: null };

  it('하나는 채워야 하고, 별점은 두 칸을 함께', () => {
    expect(ReactionBodySchema.safeParse(none).success).toBe(false);
    expect(ReactionBodySchema.safeParse({ ...none, sticker: 'MOVED' }).success).toBe(true);
    expect(ReactionBodySchema.safeParse({ ...none, scoreFact: 2 }).success).toBe(false);
    expect(ReactionBodySchema.safeParse({ ...none, scoreFact: 2, scoreDelivery: 4 }).success).toBe(false);
  });

  it('메모는 한 줄로 정리되고 60자 한도', () => {
    expect(ReactionBodySchema.parse({ ...none, memo: ' 새로\n알았다 ' }).memo).toBe('새로 알았다');
    expect(ReactionBodySchema.safeParse({ ...none, memo: '가'.repeat(61) }).success).toBe(false);
    // 공백만 있으면 비운 것 → 다른 칸이 없으면 빈 반응
    expect(ReactionBodySchema.safeParse({ ...none, memo: '   ' }).success).toBe(false);
  });

  it('방문자 등록: 토큰 해시 형식·동의 문구 판', () => {
    expect(VisitorRegisterSchema.safeParse({ tokenHash: HASH, consentVersion: '2026-11' }).success).toBe(
      true,
    );
    expect(
      VisitorRegisterSchema.safeParse({ tokenHash: 'A'.repeat(64), consentVersion: '2026-11' }).success,
    ).toBe(false);
    expect(VisitorRegisterSchema.safeParse({ tokenHash: HASH, consentVersion: '2025-01' }).success).toBe(
      false,
    );
  });
});

describe('미디어', () => {
  it('base64 해독은 Node Buffer와 같다(4,096칸 무작위)', () => {
    const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256);
    for (const n of [0, 1, 2, 3, 4095, 4096]) {
      const slice = bytes.subarray(0, n);
      expect(Array.from(decodeBase64(Buffer.from(slice).toString('base64')))).toEqual(Array.from(slice));
    }
  });

  it('분석값 전송 모양 → 쪽 계획기 모양', () => {
    const a = decodeImageAnalysis({
      edgeLuma: 0.9,
      linePitchPx: 40,
      linePitchConfidence: 0.8,
      lineProfile: Buffer.from([0, 128, 255]).toString('base64'),
      profileBinPx: 8,
    });
    expect(Array.from(a.lineProfile!)).toEqual([0, 128, 255]);
    expect(a.linePitchPx).toBe(40);
  });

  it('미디어 주소는 /assets/g/m 아래(ADR-002)', () => {
    expect(mediaPath(ID, ID2, { name: 'strip-3', ext: 'webp' })).toBe(
      `/assets/g/m/${ID}/${ID2}/strip-3.webp`,
    );
  });
});

describe('배치와 봉투', () => {
  const layout: Layout = {
    schemaVersion: 2,
    algoVersion: 2,
    templateId: 'modern-history',
    hash: '0123456789abcdef',
    units: 'm',
    parts: [],
    modules: [{ type: 'mh_wall_4m', partId: null, pos: [0, 0, 0], rotY: 0 }],
    frames: [],
    labels: [],
    fixtures: [],
    stops: [
      {
        id: 'hall',
        kind: 'hall',
        partId: null,
        artworkId: null,
        index: null,
        count: null,
        anchor: { target: [0, 2, -6], normal: [0, 1], outer: { w: 4, h: 1 }, maxDistance: 6, floorY: 0 },
      },
      {
        id: 'exit',
        kind: 'exit',
        partId: null,
        artworkId: null,
        index: null,
        count: null,
        anchor: { target: [0, 2, 20], normal: [0, -1], outer: { w: 4, h: 1 }, maxDistance: 6, floorY: 0 },
      },
    ],
    legs: [{ from: 'hall', to: 'exit', waypoints: [] }],
    map: {
      outline: [
        [
          [-5, -8],
          [5, -8],
          [5, 0],
        ],
      ],
      parts: [],
      doors: [],
      bounds: { min: [-5, -8], max: [5, 20] },
    },
    walk: {
      areas: [
        { min: [-4.7, -7.7], max: [4.7, -0.3], y: 0 },
        { min: [-1, -12], max: [1, -9], y: -1.2, slope: { axis: 'z', from: -12, to: -9, y0: -1.2, y1: 0 } },
      ],
      obstacles: [{ min: [-0.5, -5], max: [0.5, -4], tall: true }],
      spawn: { pos: [0, -1.2, -20], yaw: 0 },
    },
    exterior: { groundY: -1.2, plaza: { min: [-14, -30], max: [14, -8.3] }, facadeZ: -8.3, halfWidth: 14 },
  };

  it('배치는 그대로 왕복한다', () => {
    expect(LayoutSchema.parse(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    expect(LayoutSchema.safeParse({ ...layout, hash: 'XYZ' }).success).toBe(false);
  });

  it('성공·실패 봉투', () => {
    const ok = okEnvelope(z.object({ n: z.number() }));
    expect(ok.parse({ data: { n: 1 }, requestId: 'r1' })).toEqual({ data: { n: 1 }, requestId: 'r1' });
    const err = { error: { code: 'E_CONFLICT', message: 'rev mismatch', retryable: true } };
    expect(ApiErrorSchema.safeParse(err).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { ...err.error, code: 'E_MADE_UP' } }).success).toBe(false);
  });
});

describe('말풍선 통로(PRD_V2 W-02)', () => {
  const sid = 'abcd1234';
  it('보내기: 스티커·정해진 말 번호는 범위 안, 글은 BUBBLE_TEXT_MAX자까지', () => {
    const ok = (b: unknown) => LiveClientMessageSchema.safeParse({ t: 'bubble', b }).success;
    expect(ok({ k: 's', i: 0 })).toBe(true);
    expect(ok({ k: 's', i: 11 })).toBe(true);
    expect(ok({ k: 's', i: 12 })).toBe(false);
    expect(ok({ k: 'p', i: -1 })).toBe(false);
    expect(ok({ k: 'p', i: 2.5 })).toBe(false);
    expect(ok({ k: 'x', text: '같이 보자' })).toBe(true);
    expect(ok({ k: 'x', text: '' })).toBe(false);
    expect(ok({ k: 'x', text: '가'.repeat(21) })).toBe(false);
    expect(ok({ k: 's', i: 0, text: '덤' })).toBe(false);
    expect(ok({ k: 'q', i: 0 })).toBe(false);
  });

  it('받기: 말풍선·설정 알림, welcome의 설정은 판 2에만이라 없어도 된다', () => {
    expect(LiveServerMessageSchema.safeParse({ t: 'bubble', sid, at: 1, b: { k: 'p', i: 3 } }).success).toBe(
      true,
    );
    expect(
      LiveServerMessageSchema.safeParse({ t: 'cfg', bubbles: { enabled: false, text: false } }).success,
    ).toBe(true);
    const welcome = { t: 'welcome', you: sid, nickname: '관람객 1', peers: [], at: 0 };
    expect(LiveServerMessageSchema.safeParse(welcome).success).toBe(true);
    expect(
      LiveServerMessageSchema.safeParse({ ...welcome, n: 1, bubbles: { enabled: true, text: true } }).success,
    ).toBe(true);
  });

  it('전시 설정 기본: 말풍선 켬 · 짧은 글 끔(U-31), 예전 저장 값에도 채워진다', () => {
    expect(ExhibitionSettingsSchema.parse({}).bubbles).toEqual({ enabled: true, text: false });
    expect(ExhibitionSettingsSchema.parse({ reactions: {}, tour: {} }).bubbles).toEqual({
      enabled: true,
      text: false,
    });
  });
});
