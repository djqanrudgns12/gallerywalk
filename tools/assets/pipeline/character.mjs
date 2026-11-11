// 캐릭터 glb 최적화(규격 `tools/assets/spec/characters.md` §6, ADR-057).
// 사용: node tools/assets/pipeline/character.mjs <Tripo 원본 glb> <캐릭터 ID> [출력 폴더]
//   예: node tools/assets/pipeline/character.mjs .local/art/r4/3d/student-m.raw.glb student-m
// 결과: apps/web/public/assets/g/chr-1/<캐릭터 ID>.glb + <캐릭터 ID>-lod1.glb (출력 폴더를 주면 거기에).
//   폴더 판 번호(`chr-1`)는 `Character.tsx` `CHARACTER_BASE`와 같아야 한다 — 파일을 바꾸면 둘 다 올린다(영구 캐시, PLAN §9.6).
//   끝에 예산 검사를 하고 넘으면 종료 코드 1.
//
// 순서: 준비(키 맞춤·재질·클립 이름·제자리) → dedup → prune → weld → simplify(목표 삼각형) → resample
//       → 기본색 1024 ETC1S·법선 512 UASTC → meshopt.
//       LOD: 같은 준비본에서 idle(첫 키)·walk·run만 남기고 3천 삼각형·기본색 512·법선 맵 없음.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';

// `--tris=<n>`: 줄이는 목표만 바꿔 보는 실험(예산 검사는 규격 그대로 — 넘으면 종료 코드 1)
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const [input, id, outArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const trisFlag = Number(flags.find(f => f.startsWith('--tris='))?.slice(7));
const IDS = ['student-m', 'student-f', 'teacher-m', 'teacher-f'];
if (!input || !id || !IDS.includes(id)) {
  console.error(`사용: node tools/assets/pipeline/character.mjs <원본 glb> <${IDS.join('|')}> [출력 폴더]`);
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../../..');
const { config } = await import(join(root, 'packages/core/src/config.ts'));
const HEIGHT_M = config().CHAR_HEIGHT_M[id.startsWith('teacher') ? 'teacher' : 'student'];

/** 규격 §2 예산 — 본 판은 Tripo 3만 면을 줄이지 않는다(1.2만으로 줄이면 입가가 뭉개짐, ADR-057 보충) */
const BUDGET = { tris: 30_000, bytes: 1.5 * 1024 * 1024, materials: 1, skins: 1 };
/** 규격 §4: 꼭 있어야 하는 클립. Tripo 프리셋 이름 → 우리 이름 */
const CLIPS = ['idle', 'walk', 'run', 'wave'];
const RENAME = { wave_goodbye_01: 'wave', wave_goodbye_02: 'wave', greet_01: 'wave' };
/** 제자리로 둘 클립(엉덩이 뼈의 앞뒤·옆 이동을 없앰, 위아래 출렁임은 둠) */
const IN_PLACE = ['idle', 'walk', 'run'];
/** 기본색 1024², 법선 512²(§2) */
const BASE_PX = 1024;
const NORMAL_PX = 512;
const ROUGHNESS = 0.7;
/** 먼 거리 LOD(§2): 다른 관람객 인스턴스용 */
const LOD = { tris: 3_000, basePx: 512 };

const cli = join(root, 'node_modules/.bin/gltf-transform');
const env = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };
const outDir = outArg ? resolve(outArg) : join(root, 'apps/web/public/assets/g/chr-1');
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'gw-char-'));
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const triangles = doc =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap(m => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

/**
 * 키 맞춤을 자료에 굽는다: 꼭짓점·노드 이동·역바인드 행렬의 이동 열·동작의 이동 키를 모두 ×k.
 * (= 모든 변환을 S·M·S⁻¹로 바꾼 것 — 회전·노드 배율은 그대로.) 뿌리에 배율을 거는 방식은
 * three.js의 `SkinnedMesh` 바인드 행렬에 배율이 한 번 더 들어갈 수 있어 쓰지 않는다.
 */
const bakeScale = (doc, k) => {
  const r = doc.getRoot();
  const done = new Set();
  const once = (acc, fn) => {
    if (!acc || done.has(acc)) return;
    done.add(acc);
    const a = acc.getArray();
    fn(a, acc.getElementSize());
    acc.setArray(a);
  };
  for (const mesh of r.listMeshes())
    for (const p of mesh.listPrimitives())
      once(p.getAttribute('POSITION'), a => {
        for (let i = 0; i < a.length; i++) a[i] *= k;
      });
  for (const n of r.listNodes()) {
    const t = n.getTranslation();
    n.setTranslation([t[0] * k, t[1] * k, t[2] * k]);
  }
  for (const s of r.listSkins())
    once(s.getInverseBindMatrices(), (a, size) => {
      for (let i = 0; i < a.length; i += size) for (const j of [12, 13, 14]) a[i + j] *= k;
    });
  for (const an of r.listAnimations())
    for (const ch of an.listChannels())
      if (ch.getTargetPath() === 'translation')
        once(ch.getSampler()?.getOutput(), a => {
          for (let i = 0; i < a.length; i++) a[i] *= k;
        });
};

/** 키 맞춤, 재질 정리, 클립 이름, 제자리 */
const prepare = async (src, dst) => {
  const doc = await io.read(src);
  const r = doc.getRoot();
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const before = getBounds(scene);
  const height = before.max[1] - before.min[1];
  const k = HEIGHT_M / height;
  bakeScale(doc, k);

  // 재질: 금속·거칠기 맵 버리고 고정값(금속 0)
  for (const m of r.listMaterials()) {
    m.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(ROUGHNESS);
    m.setAlphaMode('OPAQUE').setDoubleSided(false);
  }

  // 클립 이름 맞추기, 쓰지 않는 클립 버리기
  for (const a of r.listAnimations()) {
    const name = RENAME[a.getName()] ?? a.getName();
    if (!CLIPS.includes(name) || r.listAnimations().some(b => b !== a && b.getName() === name)) {
      a.dispose();
      continue;
    }
    a.setName(name);
  }

  // 제자리: 뼈대의 첫 뼈(엉덩이)의 이동 X·Z를 쉼 자세 값으로 고정
  const skin = r.listSkins()[0];
  const hips = skin?.listJoints()[0];
  for (const a of r.listAnimations()) {
    if (!IN_PLACE.includes(a.getName()) || !hips) continue;
    for (const ch of a.listChannels()) {
      if (ch.getTargetNode() !== hips || ch.getTargetPath() !== 'translation') continue;
      const out = ch.getSampler().getOutput();
      const rest = hips.getTranslation();
      for (let i = 0; i < out.getCount(); i++) {
        const v = out.getElement(i, []);
        out.setElement(i, [rest[0], v[1], rest[2]]);
      }
    }
  }
  // 동작이 가정하는 땅 빠르기(m/s)를 재서 장면 extras에 — 뷰어가 재생 배속을 맞춘다(`Character.tsx`)
  const groundMps = Object.fromEntries(
    ['walk', 'run'].flatMap(name => {
      const a = r.listAnimations().find(x => x.getName() === name);
      const v = a && groundSpeed(doc, a);
      return v ? [[name, +v.toFixed(3)]] : [];
    }),
  );
  scene.setExtras({ ...scene.getExtras(), groundMps });
  await io.write(dst, doc);
  return { height, k, tris: triangles(doc), groundMps };
};

/** 선형 보간한 표본(회전은 구면 보간) */
const sampleAt = (sampler, t) => {
  const inp = sampler.getInput();
  const out = sampler.getOutput();
  const n = inp.getCount();
  let i = 0;
  while (i < n - 1 && inp.getElement(i + 1, [])[0] <= t) i++;
  const t0 = inp.getElement(i, [])[0];
  const t1 = i < n - 1 ? inp.getElement(i + 1, [])[0] : t0;
  const a = out.getElement(i, []);
  const b = out.getElement(Math.min(i + 1, n - 1), []);
  const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  if (a.length === 4) return new Quaternion(...a).slerp(new Quaternion(...b), u).toArray();
  return a.map((v, k) => v + (b[k] - v) * u);
};

/**
 * 제자리 걷기·뛰기 클립의 땅 빠르기: 발이 땅에 닿아 있는 동안(두 발 각자 높이의 아래 25%) 발이 뒤로 가는 빠르기의 중앙값.
 * 몸이 앞(+Z)으로 가면 디딘 발은 엉덩이 기준으로 같은 빠르기로 뒤로 간다.
 */
const groundSpeed = (doc, anim) => {
  const r = doc.getRoot();
  const parent = new Map();
  for (const n of r.listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const end = Math.max(
    ...anim.listSamplers().map(s => s.getInput().getElement(s.getInput().getCount() - 1, [])[0]),
  );
  const STEP = 1 / 120;
  const speeds = [];
  for (const side of ['Left', 'Right']) {
    const foot = r.listNodes().find(n => new RegExp(`${side}Foot$`).test(n.getName()));
    if (!foot) return null;
    const pts = [];
    for (let t = 0; t < end; t += STEP) {
      const rot = new Map();
      const tr = new Map();
      for (const ch of anim.listChannels()) {
        const v = sampleAt(ch.getSampler(), t);
        if (ch.getTargetPath() === 'rotation') rot.set(ch.getTargetNode(), v);
        else if (ch.getTargetPath() === 'translation') tr.set(ch.getTargetNode(), v);
      }
      const world = n => {
        const m = new Matrix4().compose(
          new Vector3(...(tr.get(n) ?? n.getTranslation())),
          new Quaternion(...(rot.get(n) ?? n.getRotation())),
          new Vector3(...n.getScale()),
        );
        const p = parent.get(n);
        return p ? world(p).multiply(m) : m;
      };
      pts.push(new Vector3().setFromMatrixPosition(world(foot)));
    }
    const ys = pts.map(p => p.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    for (let i = 1; i < pts.length; i++)
      if (pts[i].y < lo + 0.25 * (hi - lo)) speeds.push(-(pts[i].z - pts[i - 1].z) / STEP);
  }
  speeds.sort((x, y) => x - y);
  const mid = speeds[Math.floor(speeds.length / 2)];
  return mid && mid > 0 ? mid : null;
};

let step = 0;
const run = (current, command, ...options) => {
  const next = join(work, `step-${step++}.glb`);
  execFileSync(cli, [command, current, next, ...options], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  return next;
};

/**
 * 내보내기 한 벌: 텍스처 줄이기·압축 → (양자화 전) 키·발밑 재기 → meshopt → 예산 검사.
 * `lod`면 기본색만 `LOD.basePx`로, 법선 맵·`idle` 밖 클립은 버린다(다른 관람객 인스턴스가 idle 첫 자세로 굽는다).
 */
const finish = async (src, { name, tris, clips, basePx, normalPx }) => {
  let current = src;
  current = run(current, 'resize', '--width', String(basePx), '--height', String(basePx));
  if (normalPx) {
    current = run(
      current,
      'resize',
      '--pattern',
      '*normal*',
      '--width',
      String(normalPx),
      '--height',
      String(normalPx),
    );
  }
  current = run(current, 'etc1s', '--slots', 'baseColorTexture', '--quality', '255', '--compression', '2');
  if (normalPx) current = run(current, 'uastc', '--slots', 'normalTexture', '--level', '2', '--zstd', '18');
  // 키·발밑은 양자화 전에 잰다(스킨 메시는 양자화 배율이 노드가 아니라 역바인드 행렬에 들어가 getBounds가 못 읽음)
  const pre = await io.read(current);
  const b = getBounds(pre.getRoot().getDefaultScene() ?? pre.getRoot().listScenes()[0]);
  current = run(current, 'meshopt', '--level', 'medium');
  const out = join(outDir, `${name}.glb`);
  copyFileSync(current, out);

  // 예산 검사(규격 §2·§3·§4)
  const doc = await io.read(out);
  const r = doc.getRoot();
  const report = {
    tris: triangles(doc),
    bytes: statSync(out).size,
    materials: r.listMaterials().length,
    skins: r.listSkins().length,
    joints: r.listSkins()[0]?.listJoints().length ?? 0,
    height: +(b.max[1] - b.min[1]).toFixed(3),
    minY: +b.min[1].toFixed(3),
    clips: r.listAnimations().map(a => a.getName()),
  };
  console.log(`[char] ${name}: ${out}`);
  console.log(JSON.stringify(report));
  const fail = [];
  if (report.tris > tris) fail.push(`삼각형 ${report.tris} > ${tris}`);
  if (report.bytes > BUDGET.bytes) fail.push(`크기 ${report.bytes} > ${BUDGET.bytes}`);
  if (report.materials > BUDGET.materials) fail.push(`재질 ${report.materials}`);
  if (report.skins !== BUDGET.skins) fail.push(`뼈대 ${report.skins}`);
  if (Math.abs(report.height - HEIGHT_M) > 0.02) fail.push(`키 ${report.height} ≠ ${HEIGHT_M}`);
  if (Math.abs(report.minY) > 0.02) fail.push(`발밑 ${report.minY} ≠ 0`);
  for (const c of clips) if (!report.clips.includes(c)) fail.push(`클립 ${c} 없음`);
  if (fail.length) {
    console.error(`[char] ${name}: 예산 넘음 — ${fail.join(', ')}`);
    process.exitCode = 1;
  }
};

/**
 * LOD용: 다른 관람객 정점 애니메이션(`peerBody.ts`)이 굽는 클립만 — `idle`(첫 키 하나, 서 있는 자세)·`walk`·`run`. 법선 맵은 버린다.
 */
const LOD_CLIPS = ['idle', 'walk', 'run'];
const stripForLod = async (src, dst) => {
  const doc = await io.read(src);
  const r = doc.getRoot();
  for (const a of r.listAnimations()) if (!LOD_CLIPS.includes(a.getName())) a.dispose();
  for (const a of r.listAnimations().filter(x => x.getName() === 'idle'))
    for (const sm of a.listSamplers()) {
      const input = sm.getInput();
      const output = sm.getOutput();
      if (!input || !output) continue;
      const first = output.getElement(0, []);
      sm.setInput(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Float32Array([0])),
      );
      sm.setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(first)));
    }
  for (const m of r.listMaterials()) m.setNormalTexture(null);
  await io.write(dst, doc);
};

const simplifyTo = (src, have, target, error) => {
  if (have <= target) return src;
  // 목표보다 조금 아래로(simplify는 꼭짓점 비율이라 삼각형이 약간 남는다)
  const ratio = ((target * 0.97) / have).toFixed(4);
  return run(src, 'simplify', '--ratio', ratio, '--error', String(error));
};

try {
  let current = join(work, 'prep.glb');
  const prep = await prepare(resolve(input), current);
  console.log(
    `[char] ${id}: 키 ${prep.height.toFixed(3)}m → ${HEIGHT_M}m (×${prep.k.toFixed(3)}), 삼각형 ${prep.tris}, 동작 땅 빠르기 ${JSON.stringify(prep.groundMps)}`,
  );
  current = run(current, 'dedup');
  current = run(current, 'prune', '--keep-attributes', 'false', '--keep-leaves', 'false');
  current = run(current, 'weld');
  current = run(current, 'resample');
  const base = current;
  await finish(simplifyTo(base, prep.tris, trisFlag > 0 ? trisFlag : BUDGET.tris, 0.01), {
    name: id,
    tris: BUDGET.tris,
    clips: CLIPS,
    basePx: BASE_PX,
    normalPx: NORMAL_PX,
  });
  const lodSrc = join(work, 'lod-src.glb');
  await stripForLod(base, lodSrc);
  await finish(simplifyTo(run(lodSrc, 'prune'), prep.tris, LOD.tris, 0.05), {
    name: `${id}-lod1`,
    tris: LOD.tris,
    clips: LOD_CLIPS,
    basePx: LOD.basePx,
    normalPx: 0,
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
