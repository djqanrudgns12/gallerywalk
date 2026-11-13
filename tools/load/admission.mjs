#!/usr/bin/env node
// 실행 기본값은 네트워크 없는 dry-run. 운영·다른 앱은 실행 옵션으로도 허용하지 않는다.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { config } from '../../packages/core/src/config.ts';
import { ApiErrorSchema, okEnvelope } from '../../packages/core/src/types/api.ts';
import { EntryCodeSchema } from '../../packages/core/src/types/common.ts';
import { ExhibitionViewSchema } from '../../packages/core/src/types/exhibition.ts';
import { LiveClientMessageSchema, LiveServerMessageSchema } from '../../packages/core/src/types/live.ts';
import { mediaPath } from '../../packages/core/src/types/media.ts';
import { VisitorRegisterSchema } from '../../packages/core/src/types/reaction.ts';

const TARGET = 'http://127.0.0.1:4521';
const MS_PER_SECOND = 1000;
const REPORT_DIR = '.local/perf';
export function validateTarget(target) {
  if (target !== TARGET && target !== `${TARGET}/`) throw new Error('대상은 개발 서버 4521만 허용합니다.');
  return TARGET;
}

export function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string', default: TARGET },
      clients: { type: 'string', default: '21' },
      'duration-seconds': { type: 'string', default: '10' },
      'entry-code': { type: 'string' },
      execute: { type: 'boolean', default: false },
    },
  });
  const clients = z.enum(['21', '30']).parse(values.clients);
  const durationSeconds = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().positive().max(config().LIVE_IDLE_TIMEOUT_SEC))
    .parse(values['duration-seconds']);
  const entryCode =
    values['entry-code'] === undefined ? undefined : EntryCodeSchema.parse(values['entry-code']);
  if (values.execute && entryCode === undefined)
    throw new Error('실행에는 합성 전시의 --entry-code 입장 코드가 필요합니다.');
  return {
    target: validateTarget(values['base-url']),
    clients: Number(clients),
    durationSeconds,
    entryCode,
    execute: values.execute,
  };
}

export function planLoad(options) {
  return {
    mode: options.execute ? 'execute' : 'dry-run',
    target: validateTarget(options.target),
    clients: options.clients,
    durationSeconds: options.durationSeconds,
    stages: ['HTTP 전시 조회', 'HTTP 방문자 등록', '웹소켓 hello·위치·관람객 확인', '첫 관 미디어 받기'],
    note: 'dry-run은 HTTP·웹소켓·파일 쓰기를 하지 않습니다. 실측은 합성 전시와 --execute가 필요합니다.',
  };
}

export function summarize(samples) {
  const groups = Object.groupBy(samples, sample => sample.stage);
  return Object.fromEntries(
    Object.entries(groups).map(([stage, rows]) => {
      const ms = rows.map(row => row.ms).sort((a, b) => a - b);
      const quantile = q => ms[Math.max(0, Math.ceil(ms.length * q) - 1)];
      const errors = rows.filter(row => !row.ok).length;
      return [
        stage,
        {
          requests: rows.length,
          errors,
          errorRate: errors / rows.length,
          p50Ms: quantile(0.5),
          p95Ms: quantile(0.95),
          bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
        },
      ];
    }),
  );
}

/** 첫 관의 썸네일·벽용·소리 표지·배경음악·소리 작품. 동일 파일은 기기마다 한 번 받는다. 줌은 제외한다. */
export function firstMediaUrls(view) {
  const roomId = view.layout.parts[0]?.roomId;
  const urls = new Set();
  const append = (asset, names) => {
    for (const variant of asset?.variants ?? [])
      if (names.includes(variant.name)) urls.add(mediaPath(view.exhibition.id, asset.assetId, variant));
  };
  append(view.exhibition.poster, ['wall']);
  append(view.rooms.find(room => room.id === roomId)?.bgm?.asset, ['audio']);
  for (const art of view.artworks.filter(art => art.roomId === roomId)) {
    append(art.image?.asset ?? art.pages?.[0]?.asset, ['thumb', 'wall', 'wall-lo']);
    append(art.audio?.cover, ['cover']);
    append(art.audio?.asset, ['audio']);
  }
  return [...urls];
}

/** 인원수만 비교하면 기존 관람객이 빠진 기기를 가릴 수 있다. 이번 연결의 ID·위치를 각각 확인한다. */
export function countTogether(clients) {
  return clients.filter(
    client =>
      client.welcomed &&
      !client.unexpectedClose &&
      client.protocolErrors === 0 &&
      clients.every(
        other =>
          other === client ||
          (other.sid !== null && client.peers.has(other.sid) && client.posePeers.has(other.sid)),
      ),
  ).length;
}

/** 내 연결만 닫는다. 지연·오류율은 HTTP·소켓 단계별로 남기고 토큰·입장 코드·별명은 보고하지 않는다. */
export async function executeLoad(options) {
  validateTarget(options.target);
  const samples = [];
  const clients = [];
  const started = performance.now();
  const measure = async (stage, action) => {
    const start = performance.now();
    let bytes = 0;
    let ok = false;
    try {
      const value = await action(size => {
        bytes = size;
      });
      ok = true;
      return value;
    } finally {
      samples.push({ stage, ok, ms: performance.now() - start, bytes });
    }
  };
  const request = (path, device, schema, init = {}) =>
    measure(path.endsWith('/visitor') ? 'register' : 'entry', async received => {
      const response = await fetch(`${options.target}${path}`, {
        ...init,
        redirect: 'error',
        headers: { 'X-Device-Id': device, ...init.headers },
        signal: AbortSignal.timeout(config().API_TIMEOUT_MS),
      });
      const body = await response.arrayBuffer();
      received(body.byteLength);
      let wire;
      try {
        wire = JSON.parse(Buffer.from(body).toString('utf8'));
      } catch {
        throw new Error('API 응답 형식');
      }
      if (!response.ok) {
        const error = ApiErrorSchema.safeParse(wire);
        throw new Error(error.success ? error.data.error.code : `HTTP ${response.status}`);
      }
      return okEnvelope(schema).parse(wire).data;
    });
  const connect = (token, index) =>
    measure(
      'websocket',
      () =>
        new Promise((resolveLive, reject) => {
          const ws = new WebSocket(
            `${options.target.replace('http:', 'ws:')}/api/e/${options.entryCode}/live`,
            {
              handshakeTimeout: config().LIVE_HELLO_TIMEOUT_MS,
              maxPayload: config().LIVE_MAX_MESSAGE_BYTES * options.clients,
            },
          );
          const client = {
            ws,
            sid: null,
            peers: new Set(),
            posePeers: new Set(),
            peerMessages: 0,
            receivedBytes: 0,
            protocolErrors: 0,
            unexpectedClose: false,
            welcomed: false,
          };
          clients.push(client);
          const timer = setTimeout(
            () => reject(new Error('함께 관람 welcome 시간 초과')),
            config().LIVE_HELLO_TIMEOUT_MS,
          );
          const pose = { x: index / options.clients, y: config().EYE_HEIGHT_M, z: 0, yaw: 0, move: 0 };
          client.pose = pose;
          ws.on('open', () =>
            ws.send(
              JSON.stringify(
                LiveClientMessageSchema.parse({
                  t: 'hello',
                  v: 1,
                  token,
                  as: 'visitor',
                  character: 'student-m',
                  pose,
                }),
              ),
            ),
          );
          ws.on('message', raw => {
            client.receivedBytes += raw.length;
            let message;
            try {
              message = LiveServerMessageSchema.parse(JSON.parse(raw.toString()));
            } catch {
              client.protocolErrors++;
              reject(new Error('함께 관람 응답 형식'));
              return;
            }
            if (message.t === 'bye') {
              reject(new Error(message.code));
              client.protocolErrors++;
            }
            if (message.t === 'welcome') {
              clearTimeout(timer);
              client.welcomed = true;
              client.sid = message.you;
              for (const peer of message.peers) client.peers.add(peer.sid);
              resolveLive(client);
            } else if (message.t === 'join') client.peers.add(message.peer.sid);
            else if (message.t === 'leave') client.peers.delete(message.sid);
            else if (message.t === 'peers') {
              client.peerMessages++;
              for (const peer of message.poses) client.posePeers.add(peer.sid);
            }
          });
          ws.on('error', () => reject(new Error('함께 관람 연결 실패')));
          ws.on('close', () => {
            clearTimeout(timer);
            client.unexpectedClose = true;
            if (!client.welcomed) reject(new Error('welcome 전 연결 종료'));
          });
        }),
    );
  let completed = 0;
  let poseTimer;
  try {
    let seq = 0;
    // 미디어를 받는 동안에도 함께 관람을 유지한다. hello 승인을 받은 연결에만 위치를 보낸다.
    poseTimer = setInterval(() => {
      seq++;
      for (const client of clients)
        if (client.welcomed && client.ws.readyState === WebSocket.OPEN)
          client.ws.send(
            JSON.stringify(
              LiveClientMessageSchema.parse({
                t: 'pose',
                seq,
                pose: { ...client.pose, x: client.pose.x + Math.sin(seq / config().LIVE_POSE_HZ), move: 1 },
              }),
            ),
          );
    }, MS_PER_SECOND / config().LIVE_POSE_HZ);
    const entries = await Promise.allSettled(
      Array.from({ length: options.clients }, async (_, index) => {
        const device = randomUUID();
        const view = await request(`/api/e/${options.entryCode}`, device, ExhibitionViewSchema);
        const token = randomBytes(32).toString('base64url');
        const body = VisitorRegisterSchema.parse({
          tokenHash: createHash('sha256').update(token).digest('hex'),
          consentVersion: config().CONSENT_VERSION,
        });
        await request(
          `/api/e/${options.entryCode}/visitor`,
          device,
          z.object({ nickname: z.string().nullable() }),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const urls = firstMediaUrls(view);
        if (urls.length === 0) throw new Error('합성 그림이 있는 전시가 필요합니다.');
        // 기기들은 동시에 입장하고 각 기기 내부 미디어는 실제 미리 받기처럼 차례로 받는다.
        const work = await Promise.allSettled([
          connect(token, index),
          (async () => {
            for (const path of urls)
              await measure('media', async received => {
                const response = await fetch(`${options.target}${path}`, {
                  redirect: 'error',
                  signal: AbortSignal.timeout(config().API_TIMEOUT_MS),
                });
                const bytes = (await response.arrayBuffer()).byteLength;
                received(bytes);
                if (response.status !== 200 || bytes === 0) throw new Error('미디어 받기 실패');
              });
          })(),
        ]);
        if (work.some(result => result.status === 'rejected')) throw new Error('입장 단계 실패');
        completed++;
      }),
    );
    if (entries.every(result => result.status === 'fulfilled')) {
      await delay(options.durationSeconds * MS_PER_SECOND);
    }
    const together = countTogether(clients);
    const report = {
      at: new Date().toISOString(),
      mode: 'execute',
      target: options.target,
      clients: options.clients,
      durationSeconds: options.durationSeconds,
      elapsedMs: performance.now() - started,
      completed,
      together,
      passed: completed === options.clients && together === options.clients,
      stages: summarize(samples),
      websocket: {
        connected: clients.filter(client => client.welcomed).length,
        peerMessages: clients.reduce((sum, client) => sum + client.peerMessages, 0),
        receivedBytes: clients.reduce((sum, client) => sum + client.receivedBytes, 0),
        protocolErrors: clients.reduce((sum, client) => sum + client.protocolErrors, 0),
      },
      limitation:
        '로컬 HTTP·웹소켓·미디어 도구입니다. CDN·학교 와이파이·기기 21대의 4초 목표를 증명하지 않습니다.',
    };
    await mkdir(REPORT_DIR, { recursive: true });
    await appendFile(`${REPORT_DIR}/admission-load.jsonl`, `${JSON.stringify(report)}\n`);
    return report;
  } finally {
    clearInterval(poseTimer);
    for (const client of clients) client.ws.terminate();
  }
}

export async function main(argv) {
  const options = parseOptions(argv);
  if (!options.execute) {
    console.log(JSON.stringify(planLoad(options), null, 2));
    return;
  }
  if (process.env['RESOURCE_GUARD_ACTIVE'] !== '1')
    throw new Error('실측은 resource-guard --profile test 안에서 실행합니다.');
  const report = await executeLoad(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      '입장 부하 도구 실패. 옵션·개발 서버·합성 전시를 확인하세요. 토큰·원본 응답은 기록하지 않았습니다.',
    );
    process.exitCode = 1;
  });
