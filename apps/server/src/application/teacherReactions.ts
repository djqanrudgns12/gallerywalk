import { copy } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { canonicalJson } from '@gallery/core/layout';
import { publicSummary } from '@gallery/core/reactions';
import type { ReactionPatchSchema, TeacherReaction } from '@gallery/core/types';
import type { z } from 'zod';
import type { ArtworkRecord, Deps, ExhibitionRecord, ReactionRecord, RoomRecord } from '../ports/index.ts';
import { bump, liveExhibition } from './common.ts';

/**
 * 교사 반응 모아 보기·숨기기/고르기·내려받기(G-15, PLAN §9.2·§9.5).
 *
 * - 지운 작품(되살리기 전)의 반응은 목록·CSV·고치기 모두에서 빼고 없는 것으로 다룬다.
 * - 별명은 전시 이름 방식이 '별명'일 때만(학생 공개 집계와 같은 규칙) — '익명'이면 `null`(CSV는 '익명').
 * - 숨기기·고르기가 학생에게 보이는 공개 집계를 바꾸면 `content_version`을 올린다(학생 화면이 새로 받게).
 *   교사가 고쳐도 반응의 `updatedAt`(학생이 남긴 시각)은 그대로.
 */

type ReactionPatch = z.infer<typeof ReactionPatchSchema>;

/** CSV 열 이름·값(PLAN §9.5). 스티커·평가 이름은 `copy.reaction`을 쓰고, 나머지는 `copy`에 자리가 생기면 옮긴다. */
/** CSV 글자는 문구 파일에서(`copy.teacher.csv`) — ASCII 대체 이름 앞말만 여기(파일 이름 규칙, 화면 문구 아님) */
const CSV_TEXT = { ...copy.teacher.csv, asciiPrefix: 'reactions' } as const;

const BOM = '﻿';
const CRLF = '\r\n';
/** 수식 주입 막기: 이 글자로 시작하는 칸은 앞에 `'`(PLAN §9.5) */
const FORMULA_START = /^[=+\-@\t\r]/;
/** 파일 이름에 쓸 수 없는 글자 */
const FILE_UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;

/** 한국 시각(PLAN §9.5 `YYYY-MM-DD HH:mm`) */
const KST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const kst = (ms: number) => {
  const parts = new Map(KST.formatToParts(ms).map(part => [part.type, part.value]));
  const at = (type: Intl.DateTimeFormatPartTypes): string => parts.get(type) ?? '';
  const day = `${at('year')}${at('month')}${at('day')}`;
  return {
    stamp: `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`,
    day,
  };
};

interface Scope {
  readonly ex: ExhibitionRecord;
  readonly rooms: ReadonlyMap<string, RoomRecord>;
  /** 지우지 않은 작품 */
  readonly artworks: ReadonlyMap<string, ArtworkRecord>;
  /** 지우지 않은 작품의 반응 — 전시실 순서 → 작품 순서 → 남긴 시각 */
  readonly reactions: readonly ReactionRecord[];
  /** 방문자 별명 원문(이름 방식과 상관없이) */
  readonly visitorNickname: (r: ReactionRecord) => string | null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const scopeOf = (deps: Deps, exhibitionId: string): Scope => {
  const ex = liveExhibition(deps, exhibitionId);
  const rooms = new Map(deps.store.rooms.listByExhibition(ex.id).map(r => [r.id, r]));
  const artworks = new Map(deps.store.artworks.listByExhibition(ex.id).map(a => [a.id, a]));
  const names = new Map<string, string | null>();
  const visitorNickname = (r: ReactionRecord): string | null => {
    if (!names.has(r.visitorTokenHash))
      names.set(r.visitorTokenHash, deps.store.visitors.get(r.visitorTokenHash, ex.id)?.nickname ?? null);
    return names.get(r.visitorTokenHash) ?? null;
  };
  const position = (r: ReactionRecord) => {
    const a = artworks.get(r.artworkId);
    const room = a ? rooms.get(a.roomId) : undefined;
    return {
      roomOrder: room?.order ?? Number.POSITIVE_INFINITY,
      roomId: a?.roomId ?? '',
      artOrder: a?.order ?? Number.POSITIVE_INFINITY,
    };
  };
  const reactions = deps.store.reactions
    .listByExhibition(ex.id)
    .filter(r => artworks.has(r.artworkId))
    .sort((x, y) => {
      const a = position(x);
      const b = position(y);
      return (
        a.roomOrder - b.roomOrder ||
        compareText(a.roomId, b.roomId) ||
        a.artOrder - b.artOrder ||
        compareText(x.artworkId, y.artworkId) ||
        x.createdAt - y.createdAt ||
        compareText(x.id, y.id)
      );
    });
  return { ex, rooms, artworks, reactions, visitorNickname };
};

/** 교사에게 보이는 별명: 이름 방식이 '별명'일 때만 */
const shownNickname = (s: Scope, r: ReactionRecord): string | null =>
  s.ex.settings.reactions.naming === 'NICKNAME' ? s.visitorNickname(r) : null;

const toTeacher = (s: Scope, r: ReactionRecord): TeacherReaction => ({
  id: r.id,
  artworkId: r.artworkId,
  sticker: r.sticker,
  memo: r.memo,
  scoreFact: r.scoreFact,
  scoreDelivery: r.scoreDelivery,
  nickname: shownNickname(s, r),
  hidden: r.hidden,
  publicSelected: r.publicSelected,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** `GET …/{id}/reactions` */
export const teacherReactions = (deps: Deps, exhibitionId: string): TeacherReaction[] => {
  const s = scopeOf(deps, exhibitionId);
  return s.reactions.map(r => toTeacher(s, r));
};

/** `PATCH /api/teacher/reactions/{rid}` — 숨기기·공개로 고르기. 이 전시의(지우지 않은 작품의) 반응이 아니면 없음 */
export const patchTeacherReaction = (
  deps: Deps,
  exhibitionId: string,
  reactionId: string,
  patch: ReactionPatch,
): TeacherReaction =>
  deps.store.transaction(() => {
    const s = scopeOf(deps, exhibitionId);
    const target = s.reactions.find(r => r.id === reactionId);
    if (!target) throw new AppError('E_NOT_FOUND');
    const summaryOf = (rows: readonly ReactionRecord[]): string =>
      canonicalJson(
        publicSummary(
          s.ex.settings.reactions,
          target.artworkId,
          rows
            .filter(r => r.artworkId === target.artworkId)
            .map(r => ({ ...r, nickname: s.visitorNickname(r) })),
        ),
      );
    const before = summaryOf(s.reactions);
    const updated = deps.store.reactions.update(target.id, {
      ...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
      ...(patch.publicSelected === undefined ? {} : { publicSelected: patch.publicSelected }),
    });
    const after = summaryOf(s.reactions.map(r => (r.id === updated.id ? updated : r)));
    if (after !== before) bump(deps, s.ex, { content: true });
    return toTeacher(s, updated);
  });

export interface ReactionsCsv {
  /** `반응_{전시 이름}_{YYYYMMDD}.csv`(한국 날짜) — `filename*`(RFC 5987)로 */
  readonly filename: string;
  /** ASCII만 아는 받는 쪽을 위한 `filename` */
  readonly asciiFilename: string;
  /** UTF-8 BOM + CRLF, 모든 칸 따옴표 */
  readonly text: string;
}

const cell = (raw: string): string => {
  const safe = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

const score = (n: number | null): string => (n === null ? '' : String(n));

/** `GET …/{id}/reactions.csv`(PLAN §9.5): 반응 하나가 한 줄 */
export const reactionsCsv = (deps: Deps, exhibitionId: string): ReactionsCsv => {
  const s = scopeOf(deps, exhibitionId);
  const header = [
    CSV_TEXT.artwork,
    CSV_TEXT.room,
    CSV_TEXT.sticker,
    CSV_TEXT.memo,
    copy.reaction.scoreFact,
    copy.reaction.scoreDelivery,
    CSV_TEXT.nickname,
    CSV_TEXT.time,
    CSV_TEXT.hidden,
  ];
  const rows = s.reactions.map(r => {
    const art = s.artworks.get(r.artworkId);
    const room = art ? s.rooms.get(art.roomId) : undefined;
    return [
      art?.title ?? '',
      room?.title ?? '',
      r.sticker === null ? '' : copy.reaction.stickers[r.sticker],
      r.memo ?? '',
      score(r.scoreFact),
      score(r.scoreDelivery),
      shownNickname(s, r) ?? CSV_TEXT.anonymous,
      kst(r.updatedAt).stamp,
      r.hidden ? CSV_TEXT.yes : CSV_TEXT.no,
    ];
  });
  const text = BOM + [header, ...rows].map(row => row.map(cell).join(',')).join(CRLF) + CRLF;
  const day = kst(deps.clock.now()).day;
  const title = s.ex.title.replace(FILE_UNSAFE, '_').trim();
  return {
    filename: `${CSV_TEXT.filePrefix}_${title}_${day}.csv`,
    asciiFilename: `${CSV_TEXT.asciiPrefix}_${day}.csv`,
    text,
  };
};
