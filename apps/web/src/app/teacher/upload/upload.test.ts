import { config } from '@gallery/core/config';
import { copy, errorCopy } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../dev/studentFixtures.ts';
import {
  fakeTeacherServer,
  pngFile,
  SYNTH_FILE_NAMES as N,
  teacherArtwork,
  teacherView,
  T_EX,
} from '../../../dev/teacherFixtures.ts';
import { testRoomId, uuid } from '../../../dev/testView.ts';
import type { UploadCallOptions } from '../../../ports/index.ts';
import { planUpload, type PickedFile } from './planUpload.ts';
import { precheckFile, sniff } from './precheck.ts';
import { createUploadQueue, type UploadJob, type UploadTask } from './uploadQueue.ts';
import { problemFix, problemText } from './UploadTray.tsx';

const MB = 1024 * 1024;
const bytesFile = (name: string, bytes: readonly number[], size?: number): File => {
  const body = new Uint8Array(size ?? bytes.length);
  body.set(bytes);
  return new File([body], name);
};
const sha = async () => 'h';

describe('기기 사전 검사(PRD 6.3)', () => {
  it('그림 치수: 짧은 변 300 미만 막힘, 800 미만 흐림 경고, 비율 30 초과 막힘', async () => {
    const tiny = await precheckFile(pngFile(N.tiny, 299, 1200), 'IMAGE');
    expect(tiny).toEqual({ ok: false, problem: 'E_FILE_TOO_SMALL' });
    const blur = await precheckFile(pngFile(N.first, 700, 900), 'IMAGE');
    expect(blur).toMatchObject({ ok: true, kind: 'IMAGE', lowRes: true });
    const sharp = await precheckFile(pngFile(N.first, 1200, 900), 'IMAGE');
    expect(sharp).toMatchObject({ ok: true, lowRes: false });
    expect(await precheckFile(pngFile(N.first, 400, 400 * 31), 'IMAGE')).toEqual({
      ok: false,
      problem: 'E_ASPECT',
    });
  });

  it('막힘 문구는 PRD 그대로 + 해결법 한 줄', () => {
    expect(problemText('E_FILE_TOO_SMALL')).toBe(errorCopy.E_FILE_TOO_SMALL);
    expect(problemFix('E_FILE_TYPE')).toBe(copy.teacher.upload.fix.fileTypeWithPdf);
    expect(problemFix('E_FILE_TOO_LARGE')).toContain(String(config().MAX_IMAGE_MB));
  });

  it('크기: 그림 25MB·소리 20MB 초과 막힘', async () => {
    const big = bytesFile('a.png', [0x89, 0x50, 0x4e, 0x47], config().MAX_IMAGE_MB * MB + 1);
    expect(await precheckFile(big, 'IMAGE')).toEqual({ ok: false, problem: 'E_FILE_TOO_LARGE' });
    const loud = bytesFile('a.mp3', [0x49, 0x44, 0x33], config().MAX_AUDIO_MB * MB + 1);
    expect(await precheckFile(loud, 'AUDIO')).toEqual({ ok: false, problem: 'E_FILE_TOO_LARGE' });
  });

  it('형식: 영상(확장자·첫 바이트)·SVG·그 밖·속이 PDF가 아닌 PDF·깨진 그림', async () => {
    expect(await precheckFile(bytesFile(N.video, [0]), 'VIDEO')).toEqual({
      ok: false,
      problem: 'E_VIDEO_UNSUPPORTED',
    });
    // 확장자는 그림인데 속은 QuickTime 영상
    const mov = bytesFile('x.jpg', [0, 0, 0, 20, ...Array.from('ftypqt  ', c => c.charCodeAt(0))]);
    expect(await precheckFile(mov, 'IMAGE')).toEqual({ ok: false, problem: 'E_VIDEO_UNSUPPORTED' });
    const svg = bytesFile(
      'x.png',
      Array.from('<svg xmlns="x">', c => c.charCodeAt(0)),
    );
    expect(await precheckFile(svg, 'IMAGE')).toEqual({ ok: false, problem: 'E_FILE_TYPE' });
    expect(await precheckFile(bytesFile('x.svg', [1]), 'OTHER')).toEqual({
      ok: false,
      problem: 'E_FILE_TYPE',
    });
    // 이름만 PDF이고 속은 PDF가 아님(쪽 세기는 `pdf.test.ts`)
    expect(await precheckFile(bytesFile(N.pdf, [0x25, 0x50]), 'PDF')).toEqual({
      ok: false,
      problem: 'E_FILE_BROKEN',
    });
    expect(await precheckFile(bytesFile('x.png', [1, 2, 3, 4, 5, 6, 7, 8]), 'IMAGE')).toEqual({
      ok: false,
      problem: 'E_FILE_BROKEN',
    });
  });

  it('HEIC는 형식·크기만 보고 그대로 보낸다', async () => {
    const heic = bytesFile('x.heic', [0, 0, 0, 24, ...Array.from('ftypheic', c => c.charCodeAt(0))]);
    expect(sniff(new Uint8Array(await heic.arrayBuffer()))).toBe('HEIC');
    expect(await precheckFile(heic, 'IMAGE', { sha256Hex: sha })).toMatchObject({ ok: true, kind: 'IMAGE' });
  });

  it('글: 줄바꿈 정규화 뒤 5,000자 초과 막힘', async () => {
    const ok = new File(['가상의 시\r\n\r\n둘째 연'], 'a.txt');
    expect(await precheckFile(ok, 'TEXT', { sha256Hex: sha })).toMatchObject({
      ok: true,
      kind: 'TEXT',
      text: '가상의 시\n\n둘째 연',
    });
    const long = new File(['가'.repeat(config().TEXT_MAX_CHARS + 1)], 'b.txt');
    expect(await precheckFile(long, 'TEXT')).toEqual({ ok: false, problem: 'E_TEXT_LENGTH' });
  });

  it('소리: 10분 초과 막힘, 길이를 못 읽으면 서버에 맡김', async () => {
    const mp3 = bytesFile('a.mp3', [0x49, 0x44, 0x33, 4]);
    const over = config().AUDIO_MAX_MIN * 60_000 + 1;
    expect(await precheckFile(mp3, 'AUDIO', { audioDurationMs: async () => over })).toEqual({
      ok: false,
      problem: 'E_AUDIO_LENGTH',
    });
    expect(
      await precheckFile(mp3, 'AUDIO', { audioDurationMs: async () => null, sha256Hex: sha }),
    ).toMatchObject({ ok: true, kind: 'AUDIO' });
  });

  it('내용 해시는 같은 파일이면 같다(기본 crypto.subtle)', async () => {
    const a = await precheckFile(pngFile(N.first, 1200, 900, 1), 'IMAGE');
    const b = await precheckFile(pngFile(N.second, 1200, 900, 1), 'IMAGE');
    const c = await precheckFile(pngFile(N.second, 1200, 900, 2), 'IMAGE');
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.hash).toBe(b.hash);
      expect(a.hash).not.toBe(c.hash);
    }
  });

  it('보안 연결이 아니라 해시를 만들 수 없으면(LAN http) 막지 않고 해시 없이 통과(서버가 중복을 거름)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    try {
      const r = await precheckFile(pngFile(N.first, 1200, 900, 1), 'IMAGE');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.hash).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('폴더 규칙 → 전시실·순서(PLAN §5.2)', () => {
  const picked = (path: string, file: Blob = new Blob(['x'])): PickedFile => ({
    file,
    name: path.split('/').at(-1)!,
    path,
    size: file.size,
  });
  let seq = 0x500;
  const ctx = (view = teacherView([2, 0])) => ({
    rooms: view.rooms,
    artworks: view.artworks,
    currentRoomId: testRoomId(0),
    newId: () => uuid(seq++),
    roomTitle: (n: number) => `room ${n}`,
  });

  it('폴더 없는 파일은 지금 전시실의 마지막 다음 순서로', () => {
    const plan = planUpload([picked(N.second), picked(N.first)], ctx());
    expect(plan.newRooms).toEqual([]);
    expect(plan.jobs.map(j => j.target)).toMatchObject([
      { type: 'ARTWORK', roomId: testRoomId(0), order: 2, title: '가상 그림' },
      { type: 'ARTWORK', roomId: testRoomId(0), order: 3, title: '합성 풍경' },
    ]);
  });

  it('폴더는 새 전시실(이름판 = 폴더 이름 정리), 소리 하나는 배경음악', () => {
    const plan = planUpload([picked(N.folderB), picked(N.folderBgm), picked(N.folderA)], ctx());
    expect(plan.newRooms.map(r => [r.title, r.order])).toEqual([
      ['개항', 2],
      ['독립', 3],
    ]);
    const [first, second] = plan.newRooms;
    expect(plan.jobs.map(j => [j.target.type, j.target.roomId])).toEqual([
      ['ARTWORK', first!.id],
      ['ARTWORK', second!.id],
      ['BGM', second!.id],
    ]);
  });

  it('전시실이 하나도 없으면 첫 전시실을 만든다', () => {
    const empty = { ...teacherView([]), rooms: [] };
    const plan = planUpload([picked(N.first)], { ...ctx(empty), currentRoomId: null });
    expect(plan.newRooms.map(r => r.title)).toEqual(['room 1']);
    expect(plan.jobs[0]?.target).toMatchObject({ roomId: plan.newRooms[0]!.id, order: 0 });
  });
});

describe('올리기 줄(동시 3개·진행률·중복·처리 상태 확인)', () => {
  let n = 0x700;
  const job = (name: string, file: Blob = pngFile(name, 1200, 900, n & 0xff)): UploadJob => {
    const id = uuid(n++);
    return {
      key: id,
      file,
      name,
      kind: 'IMAGE',
      target: { type: 'ARTWORK', artworkId: id, roomId: testRoomId(0), order: n, title: name },
    };
  };
  const phases = (tasks: readonly UploadTask[]) => tasks.map(t => t.phase);
  const settle = () => new Promise(r => setTimeout(r, 0));
  const ticks = async (k = 8) => {
    for (let i = 0; i < k; i++) await settle();
  };

  it('한 번에 3개까지 보내고, 하나가 끝나면 다음, 진행률은 보낸 비율', async () => {
    const pending: { opts: UploadCallOptions | undefined; done: ReturnType<typeof deferred<unknown>> }[] = [];
    const srv = fakeTeacherServer(teacherView([0]), {
      uploadArtwork: (_e, meta, _f, opts) => {
        const done = deferred<unknown>();
        pending.push({ opts, done });
        return done.promise.then(() => teacherArtwork(0, 0, { id: meta.id, title: meta.title }));
      },
    });
    const got: string[] = [];
    const q = createUploadQueue({
      api: srv.api,
      exhibitionId: T_EX,
      onArtwork: a => got.push(a.id),
      onRoom: () => undefined,
    });
    const jobs = [job(N.first), job(N.second), job(N.third), job(N.fourth)];
    q.add(jobs);
    expect(phases(q.tasks())).toEqual(['checking', 'checking', 'checking', 'checking']);
    await ticks(20);
    expect(pending).toHaveLength(3);
    expect(phases(q.tasks())).toEqual(['sending', 'sending', 'sending', 'waiting']);
    pending[0]!.opts?.onProgress?.({ loaded: 25, total: 100 });
    expect(q.tasks()[0]?.progress).toBe(0.25);
    pending[0]!.done.resolve(null);
    await ticks();
    expect(pending).toHaveLength(4);
    expect(phases(q.tasks())).toEqual(['done', 'sending', 'sending', 'sending']);
    for (const p of pending.slice(1)) p.done.resolve(null);
    await q.idle();
    expect(got).toEqual(jobs.map(j => (j.target.type === 'ARTWORK' ? j.target.artworkId : '')));
  });

  it('사전 검사에 걸리면 보내지 않고 사유를 남긴다', async () => {
    const srv = fakeTeacherServer(teacherView([0]));
    const q = createUploadQueue({ api: srv.api, exhibitionId: T_EX, onArtwork: () => {}, onRoom: () => {} });
    q.add([job(N.tiny, pngFile(N.tiny, 120, 120))]);
    await q.idle();
    expect(q.tasks()[0]).toMatchObject({ phase: 'blocked', problem: 'E_FILE_TOO_SMALL' });
    expect(srv.named('uploadArtwork')).toHaveLength(0);
  });

  it('같은 파일을 함께 놓으면 두 번째는 보내지 않음, 서버가 E_DUPLICATE면 이미 올린 작품', async () => {
    const same = pngFile(N.first, 1200, 900, 9);
    const srv = fakeTeacherServer(teacherView([0]), {
      uploadArtwork: async () => {
        throw new AppError('E_DUPLICATE');
      },
    });
    const q = createUploadQueue({ api: srv.api, exhibitionId: T_EX, onArtwork: () => {}, onRoom: () => {} });
    q.add([job(N.first, same), job(N.second, same)]);
    await q.idle();
    expect(q.tasks().map(t => [t.phase, t.problem])).toEqual([
      ['duplicate', 'E_DUPLICATE'],
      ['duplicate', 'E_DUPLICATE'],
    ]);
    expect(srv.named('uploadArtwork')).toHaveLength(1);
  });

  it('보내기에 실패한 파일은 다시 고르면 다시 보낸다(중복으로 막지 않음), 올린 파일은 계속 막는다', async () => {
    const same = pngFile(N.first, 1200, 900, 11);
    let fail = true;
    const srv = fakeTeacherServer(teacherView([0]), {
      uploadArtwork: async (_e, meta) => {
        if (fail) throw new AppError('E_FILE_BROKEN');
        return teacherArtwork(0, 0, { id: meta.id });
      },
    });
    const q = createUploadQueue({ api: srv.api, exhibitionId: T_EX, onArtwork: () => {}, onRoom: () => {} });
    q.add([job(N.first, same)]);
    await q.idle();
    expect(q.tasks()[0]?.phase).toBe('failed');
    fail = false;
    q.add([job(N.first, same)]);
    await q.idle();
    expect(q.tasks()[1]).toMatchObject({ phase: 'done', problem: null });
    q.add([job(N.first, same)]);
    await q.idle();
    expect(q.tasks()[2]).toMatchObject({ phase: 'duplicate', problem: 'E_DUPLICATE' });
    expect(srv.named('uploadArtwork')).toHaveLength(2);
  });

  it('바쁨(E_BUSY)은 같은 ID로 조금 뒤 다시 보낸다', async () => {
    let tries = 0;
    const waits: number[] = [];
    const srv = fakeTeacherServer(teacherView([0]), {
      uploadArtwork: async (_e, meta) => {
        tries++;
        if (tries === 1) throw new AppError('E_BUSY');
        return teacherArtwork(0, 0, { id: meta.id });
      },
    });
    const q = createUploadQueue({
      api: srv.api,
      exhibitionId: T_EX,
      onArtwork: () => {},
      onRoom: () => {},
      sleep: async ms => void waits.push(ms),
    });
    const j = job(N.first);
    q.add([j]);
    await q.idle();
    expect(q.tasks()[0]?.phase).toBe('done');
    const ids = srv.named('uploadArtwork').map(c => (c.args[1] as { id: string }).id);
    expect(ids).toEqual([j.key, j.key]);
    expect(waits).toHaveLength(1);
  });

  it('답을 못 받으면 처리 상태 확인: 서버에 이미 있으면 다시 보내지 않고 그 결과', async () => {
    const j = job(N.first);
    const srv = fakeTeacherServer(teacherView([0]), {
      uploadArtwork: async (_e, meta) => {
        // 서버는 받아 처리했지만 응답이 끊김
        srv.state.artworks.push(
          teacherArtwork(0, 0, { id: meta.id, title: meta.title, warnings: ['LOW_RES'] }),
        );
        throw new AppError('E_OFFLINE');
      },
    });
    const got: string[] = [];
    const q = createUploadQueue({
      api: srv.api,
      exhibitionId: T_EX,
      onArtwork: a => got.push(a.id),
      onRoom: () => {},
      sleep: async () => {},
    });
    q.add([j]);
    await q.idle();
    expect(q.tasks()[0]?.phase).toBe('done');
    expect(got).toEqual([j.key]);
    expect(srv.named('uploadArtwork')).toHaveLength(1);
    expect(srv.named('exhibition')).toHaveLength(1);
  });

  it('처리 상태 확인에서 없으면 같은 ID로 다시, 서버가 실패로 남겼으면 그 사유', async () => {
    let tries = 0;
    const retry = job(N.first);
    const srv = fakeTeacherServer(teacherView([0]), {
      uploadArtwork: async (_e, meta) => {
        tries++;
        if (meta.id === retry.key && tries === 1) throw new AppError('E_OFFLINE');
        if (meta.id !== retry.key) {
          srv.state.artworks.push(
            teacherArtwork(0, 0, { id: meta.id, status: 'FAILED', failCode: 'E_HEIC_UNSUPPORTED' }),
          );
          throw new AppError('E_SERVER');
        }
        return teacherArtwork(0, 0, { id: meta.id });
      },
    });
    const q = createUploadQueue({
      api: srv.api,
      exhibitionId: T_EX,
      onArtwork: () => {},
      onRoom: () => {},
      sleep: async () => {},
      concurrency: 1,
    });
    const failing = job(N.second);
    q.add([retry, failing]);
    await q.idle();
    expect(q.tasks().map(t => [t.phase, t.problem])).toEqual([
      ['done', null],
      ['failed', 'E_HEIC_UNSUPPORTED'],
    ]);
  });
});
