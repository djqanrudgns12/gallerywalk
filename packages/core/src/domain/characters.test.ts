import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_CHARACTER_IDS,
  BODY_KEYS,
  DOCENT_HOME_SPOTS,
  DOCENT_IDS,
  STUDENT_CHARACTER_IDS,
  VISITOR_CHARACTER_IDS,
  bodyOf,
  buildOf,
  docentAtSpot,
  normalizeCharacterId,
  studentNumber,
  toStudentCharacterId,
  missingBones,
  REQUIRED_BONE_SUFFIXES,
} from './characters.ts';

describe('캐릭터 목록(M4-9)', () => {
  it('관람객 12명: 학생 남 5·여 5(고르기 순서 남 → 여) + 교사 2, 도슨트 3명은 따로', () => {
    expect(STUDENT_CHARACTER_IDS).toEqual([
      'student-m-01',
      'student-m-02',
      'student-m-03',
      'student-m-04',
      'student-m-05',
      'student-f-01',
      'student-f-02',
      'student-f-03',
      'student-f-04',
      'student-f-05',
    ]);
    expect(VISITOR_CHARACTER_IDS).toEqual([...STUDENT_CHARACTER_IDS, 'teacher-m', 'teacher-f']);
    expect(new Set(VISITOR_CHARACTER_IDS).size).toBe(12);
    expect(DOCENT_IDS).toEqual(['docent-1', 'docent-2', 'docent-3']);
    // 함께 관람이 받는 값 = 새 12 + 옛 별칭 2, 도슨트는 관람객이 아니라 없다
    expect(ACCEPTED_CHARACTER_IDS).toHaveLength(14);
    for (const d of DOCENT_IDS) expect(ACCEPTED_CHARACTER_IDS).not.toContain(d);
  });

  it('옛 별칭은 01번으로, 새 ID는 그대로', () => {
    expect(normalizeCharacterId('student-m')).toBe('student-m-01');
    expect(normalizeCharacterId('student-f')).toBe('student-f-01');
    for (const id of VISITOR_CHARACTER_IDS) expect(normalizeCharacterId(id)).toBe(id);
    expect(toStudentCharacterId('student-f')).toBe('student-f-01');
    expect(toStudentCharacterId('student-m-04')).toBe('student-m-04');
    for (const bad of ['teacher-m', 'docent-1', 'student-m-06', 'student-x-01', '']) {
      expect(toStudentCharacterId(bad)).toBeNull();
    }
  });

  it('몸 틀은 넷(학생·어른 × 성별), 키 틀은 둘 — 도슨트는 어른 틀이고 홀·전시실 둘은 서로 다르다', () => {
    for (const id of STUDENT_CHARACTER_IDS.slice(0, 5)) expect(bodyOf(id)).toBe('student-m');
    for (const id of STUDENT_CHARACTER_IDS.slice(5)) expect(bodyOf(id)).toBe('student-f');
    expect(bodyOf('student-m')).toBe('student-m');
    expect(bodyOf('student-f')).toBe('student-f');
    expect(bodyOf('teacher-m')).toBe('teacher-m');
    expect(bodyOf('teacher-f')).toBe('teacher-f');
    for (const id of ACCEPTED_CHARACTER_IDS) expect(BODY_KEYS).toContain(bodyOf(id));
    for (const id of STUDENT_CHARACTER_IDS) expect(buildOf(id)).toBe('student');
    expect(buildOf('teacher-m')).toBe('teacher');
    for (const d of DOCENT_IDS) {
      expect(buildOf(d)).toBe('teacher');
      expect(['teacher-m', 'teacher-f']).toContain(bodyOf(d));
    }
    // 실내에서 함께 보이는 홀·전시실 도슨트는 판 1 파일로 대신할 때도 서로 다른 모습
    expect(bodyOf('docent-2')).not.toBe(bodyOf('docent-3'));
    expect(new Set(DOCENT_IDS.map(bodyOf)).size).toBe(2);
  });

  it('학생 번호는 고르기 순서 1~10', () => {
    expect(STUDENT_CHARACTER_IDS.map(studentNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('도슨트 ↔ 기본 자리', () => {
    expect(DOCENT_HOME_SPOTS).toEqual({
      'docent-1': 'docent-plaza',
      'docent-2': 'docent-hall',
      'docent-3': 'docent-room',
    });
    expect(docentAtSpot('docent-plaza')).toBe('docent-1');
    expect(docentAtSpot('docent-hall')).toBe('docent-2');
    expect(docentAtSpot('docent-room')).toBe('docent-3');
    expect(docentAtSpot('docent-west')).toBeNull();
  });
});

describe('missingBones (엔진 필수 뼈)', () => {
  const mixamo = REQUIRED_BONE_SUFFIXES.map(s => `mixamorig:${s}`);

  it('Mixamo 이름이 다 있으면 빈 목록, 앞말(mixamorig:)은 상관없다', () => {
    expect(missingBones(mixamo)).toEqual([]);
    expect(missingBones(REQUIRED_BONE_SUFFIXES)).toEqual([]);
  });

  it('빠진 뼈를 알려 주고, 비슷한 이름(ForeArm·UpLeg·HeadTop_End)으로 대신하지 않는다', () => {
    const without = mixamo.filter(n => !/:(LeftArm|LeftLeg|Head)$/.test(n));
    expect(missingBones([...without, 'mixamorig:HeadTop_End'])).toEqual(['Head', 'LeftArm', 'LeftLeg']);
  });
});
