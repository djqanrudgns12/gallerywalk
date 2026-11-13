import { bodyOf, type CharacterId, VISITOR_CHARACTER_IDS } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { characterLodUrl } from '../scene/characterFiles.ts';
import { assignBodyGroups } from './peerGroups.ts';

const SLOTS = 4;

describe('다른 관람객 몸 묶음(M4-9, 그리기 예산)', () => {
  it('판 2 파일이 없으면 12종이 몸 틀 넷의 판 1 파일로 묶여 모두 제 모습(묶음 ≤ 4)', () => {
    const crowd: CharacterId[] = [
      ...VISITOR_CHARACTER_IDS,
      ...VISITOR_CHARACTER_IDS,
      'student-m',
      'student-f',
    ];
    const got = assignBodyGroups(crowd, k => characterLodUrl(k), bodyOf, SLOTS);
    for (const k of crowd) expect(got.get(k)).toBe(characterLodUrl(k));
    expect(new Set(got.values())).toEqual(
      new Set([
        '/assets/g/chr-1/student-m-lod1.glb',
        '/assets/g/chr-1/student-f-lod1.glb',
        '/assets/g/chr-1/teacher-m-lod1.glb',
        '/assets/g/chr-1/teacher-f-lod1.glb',
      ]),
    );
  });

  it('판 2 파일이 다 오면: 몸 틀마다 가장 가까운 사람의 모습을 먼저, 남는 자리는 가까운 순서, 나머지는 같은 틀 묶음으로', () => {
    const all = new Set<CharacterId>(VISITOR_CHARACTER_IDS);
    const lod = (k: CharacterId): string => characterLodUrl(k, all);
    // 가까운 순서: 남 3명(서로 다른 모습) → 교사 남 → 여 2명 → 남 1명 더
    const near: CharacterId[] = [
      'student-m-02',
      'student-m-04',
      'student-m-05',
      'teacher-m',
      'student-f-03',
      'student-f-01',
      'student-m-01',
    ];
    const got = assignBodyGroups(near, lod, bodyOf, SLOTS);
    const files = new Set(got.values());
    expect(files.size).toBe(SLOTS);
    // ① 몸 틀마다 가장 가까운 사람(남 02·교사 남·여 03) ② 남는 한 자리는 가까운 순서로 남 04
    expect(files).toEqual(
      new Set(['student-m-02', 'student-m-04', 'teacher-m', 'student-f-03'].map(k => lod(k as CharacterId))),
    );
    expect(got.get('student-m-05')).toBe(lod('student-m-02'));
    expect(got.get('student-m-01')).toBe(lod('student-m-02'));
    expect(got.get('student-f-01')).toBe(lod('student-f-03'));
    // 키·성별 틀은 섞이지 않는다
    for (const [k, file] of got) expect(file).toContain(`/${bodyOf(k).slice(0, 9)}`);
  });

  it('지난 장면에 잡은 모습은 그 틀의 누군가 쓰는 동안 그대로(가까운 순서가 바뀌어도 깜빡이지 않음)', () => {
    const all = new Set<CharacterId>(VISITOR_CHARACTER_IDS);
    const lod = (k: CharacterId): string => characterLodUrl(k, all);
    const slots = 2;
    const first = assignBodyGroups<CharacterId>(
      ['student-m-01', 'student-f-01', 'student-m-02'],
      lod,
      bodyOf,
      slots,
    );
    expect(first.get('student-m-02')).toBe(lod('student-m-01'));
    // 남 02가 더 가까워져도 남 01이 아직 있으면 남 01 모습을 둔다
    const next = assignBodyGroups<CharacterId>(
      ['student-m-02', 'student-f-01', 'student-m-01'],
      lod,
      bodyOf,
      slots,
      new Set(first.values()),
    );
    expect(next.get('student-m-02')).toBe(lod('student-m-01'));
    // 남 01이 떠나면 그때 남 02 모습으로
    const gone = assignBodyGroups<CharacterId>(
      ['student-m-02', 'student-f-01'],
      lod,
      bodyOf,
      slots,
      new Set(next.values()),
    );
    expect(gone.get('student-m-02')).toBe(lod('student-m-02'));
  });

  it('자리가 몸 틀 수보다 적으면 자리를 못 얻은 틀의 사람은 몸 없이', () => {
    const got = assignBodyGroups<CharacterId>(
      ['student-m-01', 'teacher-f'],
      k => characterLodUrl(k),
      bodyOf,
      1,
    );
    expect([...got.keys()]).toEqual(['student-m-01']);
  });
});
