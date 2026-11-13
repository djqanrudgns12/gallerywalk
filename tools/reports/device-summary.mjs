#!/usr/bin/env node
// 기기 보고 요약(G-24·G-25, FIELD_PLAN HW-02, ADR-070): 서버가 남긴 `reports/device-YYYY-MM-DD.jsonl`을 읽어 표로 찍는다.
// 의존성 없이 node만 쓴다. 폴더는 인자로 받는다(운영 폴더를 기본값으로 두지 않음).
//
//   node tools/reports/device-summary.mjs <보고 폴더> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]
//   npm run reports:summary -- <보고 폴더>
//
// 줄 = `{at, exhibitionId, ...DeviceReport}`(packages/core/src/types/diag.ts). 모양이 틀린 줄은 건너뛰고 수만 알린다.
// 전시 ID는 찍지 않는다(몇 전시에서 왔는지 수만).
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_FILE = /^device-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 가운데값·p90을 볼 수 */
export const METRICS = ['readyMs', 'firstFrameMs', 'fpsP50', 'fpsP10', 'inputP95Ms', 'frameP95Ms'];
/** 갈래별 수를 볼 칸 */
export const GROUPS = ['platform', 'browser', 'device', 'gpu', 'mode'];
const P50 = 0.5;
const P90 = 0.9;
const PERCENT = 100;

const usage = () =>
  [
    '쓰는 법: node tools/reports/device-summary.mjs <보고 폴더> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]',
    '  <보고 폴더>  device-YYYY-MM-DD.jsonl 파일이 있는 폴더(서버 DATA_DIR/reports)',
    '  --from/--to  파일 날짜(KST) 범위, 양 끝 포함',
    '  --json       표 대신 JSON 한 덩이',
  ].join('\n');

export const parseArgs = argv => {
  const out = { dir: undefined, from: undefined, to: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--from' || arg === '--to') {
      const value = argv[++i];
      if (!value || !DAY.test(value)) throw new Error(`${arg}: YYYY-MM-DD 날짜가 필요합니다`);
      out[arg.slice(2)] = value;
    } else if (arg === '--help' || arg === '-h') throw new Error(usage());
    else if (arg.startsWith('--')) throw new Error(`모르는 선택: ${arg}\n${usage()}`);
    else if (out.dir === undefined) out.dir = arg;
    else throw new Error(`폴더는 하나만: ${arg}`);
  }
  if (out.dir === undefined) throw new Error(usage());
  return out;
};

/** 정렬된 수의 분위(가까운 순위 방식). 비었으면 null */
export const quantile = (sorted, q) => {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank];
};

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** 한 줄이 보고 모양(최소한의 칸)인가 */
const looksLikeReport = row =>
  isRecord(row) &&
  row.v === 1 &&
  typeof row.platform === 'string' &&
  typeof row.browser === 'string' &&
  typeof row.device === 'string' &&
  (row.mode === '3d' || row.mode === '2d');

export const readReports = async (dir, { from, to } = {}) => {
  const names = (await readdir(dir))
    .map(name => ({ name, day: REPORT_FILE.exec(name)?.[1] }))
    .filter(
      f => f.day !== undefined && (from === undefined || f.day >= from) && (to === undefined || f.day <= to),
    )
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const rows = [];
  let skipped = 0;
  for (const { name } of names) {
    const text = await readFile(join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        skipped += 1;
        continue;
      }
      if (looksLikeReport(row)) rows.push(row);
      else skipped += 1;
    }
  }
  return { files: names.map(f => f.name), days: names.map(f => f.day), rows, skipped };
};

const countBy = (rows, key) => {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] === null || row[key] === undefined ? '(없음)' : String(row[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};

const metricStats = (rows, metric) => {
  const values = rows
    .map(r => r[metric])
    .filter(finite)
    .sort((a, b) => a - b);
  return { n: values.length, p50: quantile(values, P50), p90: quantile(values, P90) };
};

export const summarize = ({ rows, files, days, skipped }) => {
  const total = rows.length;
  const light = rows.filter(r => r.mode === '2d');
  const exhibitions = new Set(rows.map(r => r.exhibitionId).filter(id => typeof id === 'string'));
  return {
    files: files.length,
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
    reports: total,
    skipped,
    exhibitions: exhibitions.size,
    groups: Object.fromEntries(GROUPS.map(key => [key, countBy(rows, key)])),
    metrics: Object.fromEntries(METRICS.map(m => [m, metricStats(rows, m)])),
    byPlatform: Object.fromEntries(
      countBy(rows, 'platform').map(([platform]) => [
        platform,
        Object.fromEntries(
          METRICS.map(m => [
            m,
            metricStats(
              rows.filter(r => String(r.platform) === platform),
              m,
            ),
          ]),
        ),
      ]),
    ),
    light: {
      count: light.length,
      ratio: total === 0 ? null : light.length / total,
      reasons: countBy(light, 'fallback'),
    },
  };
};

// ── 표 찍기 ─────────────────────────────────────────────────────

const show = value => (value === null || value === undefined ? '-' : String(value));
/** 글자 칸 너비: 한글·한자(넓은 글자)는 두 칸 */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
const widthOf = text => [...text].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0);
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - widthOf(text)));
const table = (header, body) => {
  const widths = header.map((h, i) => Math.max(widthOf(h), ...body.map(row => widthOf(show(row[i])))));
  const line = cells =>
    cells
      .map((cell, i) => pad(show(cell), widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), widths.map(w => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
};
const pct = (n, total) => (total === 0 ? '-' : `${((n / total) * PERCENT).toFixed(1)}%`);

export const render = s => {
  const out = [];
  out.push(
    `기기 보고 ${s.reports}개 · 파일 ${s.files}개(${show(s.firstDay)} ~ ${show(s.lastDay)}) · 전시 ${s.exhibitions}곳` +
      (s.skipped > 0 ? ` · 모양이 틀려 건너뛴 줄 ${s.skipped}` : ''),
  );
  for (const key of GROUPS) {
    out.push(
      '',
      `[${key}]`,
      table(
        [key, '수', '비율'],
        s.groups[key].map(([v, n]) => [v, n, pct(n, s.reports)]),
      ),
    );
  }
  out.push(
    '',
    '[반응성 전체]',
    table(
      ['값', 'n', '가운데값', 'p90'],
      METRICS.map(m => [m, s.metrics[m].n, s.metrics[m].p50, s.metrics[m].p90]),
    ),
  );
  for (const [platform, metrics] of Object.entries(s.byPlatform)) {
    out.push(
      '',
      `[반응성 · ${platform}]`,
      table(
        ['값', 'n', '가운데값', 'p90'],
        METRICS.map(m => [m, metrics[m].n, metrics[m].p50, metrics[m].p90]),
      ),
    );
  }
  out.push(
    '',
    `[가벼운 화면(2D)] ${s.light.count}개 · ${s.light.ratio === null ? '-' : pct(s.light.count, s.reports)}`,
    table(
      ['까닭', '수', '2D 중 비율'],
      s.light.reasons.map(([reason, n]) => [reason, n, pct(n, s.light.count)]),
    ),
  );
  return out.join('\n');
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  const dir = resolve(args.dir);
  let read;
  try {
    read = await readReports(dir, args);
  } catch (err) {
    process.stderr.write(
      `보고 폴더를 읽지 못했습니다: ${dir} (${err instanceof Error ? err.message : String(err)})\n`,
    );
    process.exit(1);
  }
  const summary = summarize(read);
  process.stdout.write(`${args.json ? JSON.stringify(summary, null, 2) : render(summary)}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
