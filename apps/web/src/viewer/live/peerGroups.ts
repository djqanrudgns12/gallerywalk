/**
 * 다른 관람객의 몸 묶음 고르기(M4-9, 그리기 예산 — e2e `walk-dev` "가짜 관람객 30명: 혼자일 때보다 +6 이하").
 * 묶음 = 같은 먼 거리 LOD 파일을 쓰는 캐릭터들 → `InstancedMesh` 하나(그리기 1회). 몸 그리기는 `slots`회까지라
 * 몸 틀 수(4) + 이름표 1 + 발밑 그늘 1 = +6을 넘지 않는다.
 *
 * 1. 몸 틀마다 묶음 하나를 먼저 잡는다: 지난 장면에 잡았던 파일을 그 틀의 누군가 아직 쓰면 그대로(모습이 깜빡이지 않게),
 *    아니면 그 틀에서 가장 가까운 사람의 파일.
 * 2. 남는 자리는 가까운 사람 순서로 아직 못 잡은 파일에(지난 장면에 잡았던 것 먼저).
 * 3. 자리를 못 얻은 파일의 사람은 같은 몸 틀의 묶음으로 그린다 — 키·성별 실루엣은 맞고 얼굴·옷만 이웃 것.
 *    `slots`가 몸 틀 수보다 작아 틀째 자리를 못 얻으면 그 사람은 결과에 없다(몸 없이 이름표만).
 *
 * 판 2 파일이 오기 전에는 몸 틀마다 파일이 하나뿐이라 모두 제 모습이다.
 */
export const assignBodyGroups = <K extends string>(
  /** 온몸으로 그릴 사람들의 캐릭터(가까운 순서, 한 사람에 하나) */
  nearestFirst: readonly K[],
  fileOf: (k: K) => string,
  bodyOf: (k: K) => string,
  slots: number,
  /** 지난 장면에 잡았던 파일 */
  previous: ReadonlySet<string> = new Set<string>(),
): Map<K, string> => {
  /** 몸 틀 → 그 틀의 파일(가까운 순서) · 모든 파일(가까운 순서) */
  const byBody = new Map<string, string[]>();
  const order: string[] = [];
  for (const k of nearestFirst) {
    const file = fileOf(k);
    const body = bodyOf(k);
    const list = byBody.get(body);
    if (!list) byBody.set(body, [file]);
    else if (!list.includes(file)) list.push(file);
    if (!order.includes(file)) order.push(file);
  }
  const active = new Set<string>();
  const primary = new Map<string, string>();
  for (const [body, files] of byBody) {
    if (active.size >= slots) break;
    const keep = files.find(f => previous.has(f)) ?? files[0];
    if (keep === undefined) continue;
    active.add(keep);
    primary.set(body, keep);
  }
  const rest = order.filter(f => !active.has(f));
  for (const f of [...rest.filter(f => previous.has(f)), ...rest.filter(f => !previous.has(f))]) {
    if (active.size >= slots) break;
    active.add(f);
  }
  const out = new Map<K, string>();
  for (const k of nearestFirst) {
    if (out.has(k)) continue;
    const own = fileOf(k);
    const file = active.has(own) ? own : primary.get(bodyOf(k));
    if (file !== undefined) out.set(k, file);
  }
  return out;
};
