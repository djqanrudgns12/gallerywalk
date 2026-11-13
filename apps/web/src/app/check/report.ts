import { copy, fill } from '@gallery/core/copy';
import { deviceKindOf, osOf } from '../../viewer/quality/tier.ts';
import type { StepId, StepResult } from './steps.ts';

/**
 * 점검 결과 → 요약 한 줄·정보 담당에게 보낼 글(FIELD_PLAN HW-00·HW-07). 순수 함수.
 * 요청 글은 `copy.check.request` 줄을 채운 것이고, 기기는 몇 갈래로만 적는다(원문 UA를 싣지 않음).
 */

export type Summary = keyof typeof copy.check.summary;

/** 이 단계 중 하나라도 막히면 "막힌 곳이 있어요"(①은 따로 — 닿지 않음) */
const BLOCKING: readonly StepId[] = ['app', 'space', 'decoder', 'artwork', 'live'];

const stateOf = (results: readonly StepResult[], id: StepId): StepResult['state'] | undefined =>
  results.find(r => r.id === id)?.state;

/** 닿지 않음 > 막힘 > 3D 없음 > 느림 > 됨 */
export const summaryOf = (results: readonly StepResult[]): Summary => {
  if (stateOf(results, 'server') === 'fail') return 'unreachable';
  if (BLOCKING.some(id => stateOf(results, id) === 'fail')) return 'blocked';
  if (stateOf(results, 'webgl') === 'fail') return 'no3d';
  if (results.some(r => r.state === 'slow')) return 'slow';
  return 'ok';
};

const MS_PER_SEC = 1000;

/** ms → 초(소수 한 자리) 글 */
export const secText = (ms: number): string => (ms / MS_PER_SEC).toFixed(1);

/** 한 단계 한 줄: `1. 단계 이름: 상태 (빠르기) (걸린 시간) | 기술 이름` */
export const resultLine = (r: StepResult, index: number): string => {
  const t = copy.check;
  const speed = r.mbps === null ? '' : ` ${fill(t.speedValue, { mbps: r.mbps.toFixed(1) })}`;
  const took = r.ms === null ? '' : ` (${fill(t.took, { sec: secText(r.ms) })})`;
  const detail = r.detail === '' ? '' : ` | ${r.detail}`;
  return `${index + 1}. ${t.steps[r.id]}: ${t.state[r.state]}${speed}${took}${detail}`;
};

export interface RequestContext {
  /** 전시관 주소(`location.host`) */
  readonly host: string;
  /** 점검 시각 글 */
  readonly date: string;
  /** 기기 갈래(`deviceLabelOf`) */
  readonly device: string;
}

/** 정보 담당에게 보낼 글 전체(줄바꿈으로 이음) */
export const requestText = (results: readonly StepResult[], ctx: RequestContext): string => {
  const result = results.map(resultLine).join('\n');
  return copy.check.request.map(line => fill(line, { ...ctx, result })).join('\n');
};

const OS_NAME: Readonly<Record<ReturnType<typeof osOf>, string>> = {
  ios: 'iOS',
  android: 'Android',
  other: '',
};
/** 터치 화면 노트북도 데스크톱으로(터치 수만 보면 태블릿으로 잡힌다) */
const DESKTOP_OS = /Windows NT|CrOS|X11|Macintosh/;

/**
 * 기기 갈래: 운영체제(iOS·Android) + 데스크톱·태블릿·휴대폰. 품질 단계와 같은 규칙(`viewer/quality/tier.ts`)을 쓴다.
 * 원문 UA·기종 이름은 싣지 않는다.
 */
export const deviceLabelOf = (ua: string, touchPoints: number, shortSidePx: number): string => {
  const os = osOf(ua, touchPoints);
  const kind = os === 'other' && DESKTOP_OS.test(ua) ? 'desktop' : deviceKindOf(touchPoints, shortSidePx);
  return [OS_NAME[os], kind].filter(part => part !== '').join(' ');
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 점검 시각: 이 기기 시간대의 `YYYY-MM-DD HH:mm` */
export const stampOf = (epochMs: number): string => {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
