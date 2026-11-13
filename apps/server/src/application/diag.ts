import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { isGone } from '@gallery/core/retention';
import { DIAG_REASONS, type DiagBody, type DiagReason } from '@gallery/core/types';
import type { Clock, Deps, DeviceDiag, DeviceReportFiles, DiagRecent } from '../ports/index.ts';

/**
 * 기기 진단(G-24·G-25, FIELD_PLAN HW-02, ADR-070): `POST /api/e/{code}/diag`.
 *
 * - `fail`: 전시 ID·분 칸마다 까닭별 수만 **메모리에** 둔다. `DIAG_COUNT_WINDOW_MIN`분이 지난 칸은 버린다(분 단위라
 *   한 칸이 창 끝에서 1분 안쪽만큼 일찍 빠질 수 있다). 서버를 다시 시작하면 0부터 — 교사 화면의 "지금 수업" 안내용이다.
 * - `report`: 받은 시각·전시 ID를 붙여 보고 파일에 한 줄(파일 쓰기는 `DeviceReportFiles`가 기다리지 않고 한다).
 * - 토큰·IP·기기 ID는 이 모듈에 들어오지 않는다(라우트가 속도 칸에만 쓰고 넘기지 않음).
 */

const MS_PER_MIN = 60_000;

interface Slot {
  readonly minute: number;
  readonly counts: Map<DiagReason, number>;
}

const minuteOf = (ms: number): number => Math.floor(ms / MS_PER_MIN);

export interface DeviceDiagOptions {
  readonly clock: Clock;
  readonly files: DeviceReportFiles;
}

export const createDeviceDiag = ({ clock, files }: DeviceDiagOptions): DeviceDiag => {
  /** 전시 ID → 분 칸(오래된 것부터) */
  const book = new Map<string, Slot[]>();
  let minuteFail = 0;
  let minuteReport = 0;

  /** 창 밖 칸을 버리고 남은 칸. 남은 것이 없으면 그 전시를 지운다 */
  const fresh = (exhibitionId: string, nowMin: number): Slot[] => {
    const slots = book.get(exhibitionId);
    if (!slots) return [];
    const oldest = nowMin - config().DIAG_COUNT_WINDOW_MIN + 1;
    let drop = 0;
    while (drop < slots.length && (slots[drop]?.minute ?? oldest) < oldest) drop += 1;
    if (drop > 0) slots.splice(0, drop);
    if (slots.length === 0) book.delete(exhibitionId);
    return slots;
  };

  return {
    fail(exhibitionId, reason) {
      const nowMin = minuteOf(clock.now());
      const slots = fresh(exhibitionId, nowMin);
      let last = slots.at(-1);
      // 시계가 뒤로 가도 칸 차례가 꼬이지 않게 마지막 칸에 더한다
      if (!last || last.minute < nowMin) {
        last = { minute: nowMin, counts: new Map() };
        slots.push(last);
        book.set(exhibitionId, slots);
      }
      last.counts.set(reason, (last.counts.get(reason) ?? 0) + 1);
      minuteFail += 1;
    },
    report(exhibitionId, report) {
      files.append({ at: new Date(clock.now()).toISOString(), exhibitionId, ...report });
      minuteReport += 1;
    },
    recent(exhibitionId): DiagRecent {
      const slots = fresh(exhibitionId, minuteOf(clock.now()));
      const reasons: Partial<Record<DiagReason, number>> = {};
      let light = 0;
      // 까닭 차례는 약속(`DIAG_REASONS`) 순서로 — 응답 모양이 받은 순서에 따라 바뀌지 않게
      for (const reason of DIAG_REASONS) {
        let n = 0;
        for (const slot of slots) n += slot.counts.get(reason) ?? 0;
        if (n > 0) reasons[reason] = n;
        light += n;
      }
      return { light, reasons };
    },
    takeMinute() {
      const nowMin = minuteOf(clock.now());
      for (const id of [...book.keys()]) fresh(id, nowMin);
      const out = { fail: minuteFail, report: minuteReport };
      minuteFail = 0;
      minuteReport = 0;
      return out;
    },
  };
};

/** 입장 코드 → 열린 전시(준비 중·닫힘은 그 코드, 없거나 만료·지우는 중이면 없음 — 학생 경로와 같은 규칙) */
const openByCode = (deps: Pick<Deps, 'store' | 'clock'>, entryCode: string): string => {
  const ex = deps.store.exhibitions.getByEntryCode(entryCode);
  if (!ex || isGone(ex, deps.clock.now())) throw new AppError('E_NOT_FOUND');
  if (ex.status === 'DRAFT') throw new AppError('E_EXHIBITION_DRAFT');
  if (ex.status === 'CLOSED') throw new AppError('E_EXHIBITION_CLOSED');
  return ex.id;
};

/** 진단 하나 받기 → 그 전시 ID(접근 기록용). `deps.diag`가 없으면 확인만 하고 버린다 */
export const acceptDiag = (
  deps: Pick<Deps, 'store' | 'clock' | 'diag'>,
  entryCode: string,
  body: DiagBody,
): string => {
  const exhibitionId = openByCode(deps, entryCode);
  if (body.kind === 'fail') deps.diag?.fail(exhibitionId, body.reason);
  else deps.diag?.report(exhibitionId, body.report);
  return exhibitionId;
};
