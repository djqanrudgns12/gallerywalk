import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { expiresAt } from '@gallery/core/retention';
import { type CreateExhibition, ExhibitionSettingsSchema, type PatchExhibition } from '@gallery/core/types';
import type { Deps, ExhibitionRecord } from '../ports/index.ts';
import { assertRev, bump, createHashOf, liveExhibition } from './common.ts';

const MINUTES_PER_DAY = 1_440;

/**
 * 전시 만들기·고치기·열기/닫기(PLAN §9.2 교사 표, ADR-023·024·048).
 */

export interface CreateContext {
  /** 이 기기가 이미 시작 코드를 맞혔는가(`teacher_devices`) */
  readonly deviceRegistered: boolean;
}

export interface CreateOutcome {
  readonly exhibitionId: string;
  readonly entryCode: string;
  readonly expiresAt: number;
  /** 시작 코드를 맞혔으니 이 기기를 등록하라(라우트가 `teacher_devices`에 넣음) */
  readonly registerDevice: boolean;
}

const pickEntryCode = (deps: Deps): string => {
  // 숫자 6자리 100000~999999(ADR-023). 90만 가지라 몇 번이면 빈 자리를 찾는다.
  const digits = config().ENTRY_CODE_DIGITS;
  const lo = 10 ** (digits - 1);
  const hi = 10 ** digits - 1;
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = String(deps.random.int(lo, hi));
    if (!deps.store.exhibitions.entryCodeTaken(code)) return code;
  }
  throw new AppError('E_SERVER');
};

/** `POST /api/teacher/exhibitions` — 같은 ID·같은 본문으로 다시 오면 처음 결과(멱등) */
export const createExhibition = (deps: Deps, body: CreateExhibition, ctx: CreateContext): CreateOutcome => {
  const c = config();
  const hash = createHashOf(body);
  return deps.store.transaction(() => {
    const existing = deps.store.exhibitions.get(body.exhibitionId);
    if (existing) {
      if (existing.createHash !== hash) throw new AppError('E_CONFLICT');
      return {
        exhibitionId: existing.id,
        entryCode: existing.entryCode,
        expiresAt: existing.expiresAt,
        registerDevice: false,
      };
    }
    let registerDevice = false;
    if (c.START_CODE_REQUIRED && !ctx.deviceRegistered) {
      if (body.startCode === undefined || !deps.security.startCodeOk(body.startCode))
        throw new AppError('E_START_CODE');
      registerDevice = true;
    }
    if (deps.security.isWeakPin(body.pin)) throw new AppError('E_PIN_WEAK');
    const pinHmac = deps.security.pinHmac(body.pin);
    if (deps.store.exhibitions.pinTaken(pinHmac, null)) throw new AppError('E_PIN_TAKEN');
    const now = deps.clock.now();
    const rec: ExhibitionRecord = {
      id: body.exhibitionId,
      entryCode: pickEntryCode(deps),
      pinHmac,
      title: body.title,
      subtitle: body.subtitle ?? null,
      templateId: body.templateId,
      posterAssetId: null,
      schoolName: null,
      className: null,
      showSchool: false,
      settings: body.settings ?? ExhibitionSettingsSchema.parse({}),
      status: 'DRAFT',
      retentionDays: c.EXHIBITION_TTL_DAYS,
      rev: 1,
      createHash: hash,
      contentVersion: 1,
      settingsVersion: 1,
      layoutVersion: 0,
      layoutDirty: true,
      deleting: false,
      createdAt: now,
      expiresAt: expiresAt(
        now,
        deps.retentionTestMinutes === undefined
          ? c.EXHIBITION_TTL_DAYS
          : deps.retentionTestMinutes / MINUTES_PER_DAY,
      ),
      openedAt: null,
      closedAt: null,
    };
    deps.store.exhibitions.insert(rec);
    deps.store.sessions.insert({
      tokenHash: body.linkTokenHash,
      exhibitionId: rec.id,
      kind: 'LINK',
      createdAt: now,
      lastUsedAt: now,
    });
    return { exhibitionId: rec.id, entryCode: rec.entryCode, expiresAt: rec.expiresAt, registerDevice };
  });
};

/** `PATCH /api/teacher/exhibitions/{id}` (`If-Match: {rev}`) */
export const patchExhibition = (
  deps: Deps,
  exhibitionId: string,
  patch: PatchExhibition,
  ifMatch: number | null,
): ExhibitionRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    assertRev(ex, ifMatch);
    const updated = deps.store.exhibitions.update(ex.id, { ...patch, rev: ex.rev + 1 });
    const settingsChanged = patch.settings !== undefined;
    const contentChanged =
      patch.title !== undefined ||
      patch.subtitle !== undefined ||
      patch.schoolName !== undefined ||
      patch.className !== undefined ||
      patch.showSchool !== undefined;
    // 템플릿이 바뀌면 배치 문법·치수가 바뀐다
    return bump(deps, updated, {
      content: contentChanged || patch.templateId !== undefined,
      settings: settingsChanged,
      layout: patch.templateId !== undefined,
    });
  });

type Transition = 'open' | 'close' | 'reopen';

/** `POST …/{id}/open` · `/close` · `/reopen`. 게시 작품이 없으면 열 수 없다. */
export const changeStatus = (deps: Deps, exhibitionId: string, action: Transition): ExhibitionRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const now = deps.clock.now();
    const want = { open: 'OPEN', close: 'CLOSED', reopen: 'OPEN' } as const;
    const from = { open: ['DRAFT'], close: ['OPEN'], reopen: ['CLOSED'] } as const;
    if (ex.status === want[action]) return ex; // 이미 그 상태면 그대로(다시 보내기 안전)
    if (!(from[action] as readonly string[]).includes(ex.status)) throw new AppError('E_CONFLICT');
    if (want[action] === 'OPEN') {
      const published = deps.store.artworks
        .listByExhibition(ex.id)
        .some(a => a.status === 'PUBLISHED' && a.deletedAt === null);
      if (!published) throw new AppError('E_NOTHING_PUBLISHED');
    }
    const updated = deps.store.exhibitions.update(ex.id, {
      status: want[action],
      rev: ex.rev + 1,
      ...(want[action] === 'OPEN' ? { openedAt: ex.openedAt ?? now, closedAt: null } : { closedAt: now }),
    });
    return bump(deps, updated, { content: true });
  });

/** `POST …/{id}/link/rotate`: LINK 세션을 모두 지우고 새 해시(PIN 세션은 그대로, PLAN §11.1) */
export const rotateLink = (deps: Deps, exhibitionId: string, linkTokenHash: string): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    deps.store.sessions.deleteKind(ex.id, 'LINK');
    const now = deps.clock.now();
    deps.store.sessions.insert({
      tokenHash: linkTokenHash,
      exhibitionId: ex.id,
      kind: 'LINK',
      createdAt: now,
      lastUsedAt: now,
    });
  });
