import { describe, expect, it } from 'vitest';
import type { CharacterKey } from '@gallery/core/types';
import { characterFaceUrl, characterGlbUrl, studentFaceImages } from './characterFiles.ts';

describe('캐릭터 파일 주소(M4-9)', () => {
  const files = new Set<CharacterKey>(['student-m-03', 'docent-2', 'student-f-01']);

  it('들어온 ID는 chr-2 제 파일, 없으면 같은 몸 틀의 chr-1 파일', () => {
    expect(characterGlbUrl('student-m-03', files)).toBe('/assets/g/chr-2/student-m-03.glb');
    expect(characterGlbUrl('student-m-04', files)).toBe('/assets/g/chr-1/student-m.glb');
    // 옛 별칭은 01번으로 찾는다
    expect(characterGlbUrl('student-f', files)).toBe('/assets/g/chr-2/student-f-01.glb');
  });

  it('얼굴 그림: 들어온 것만 주소, 없으면 null(실루엣·아이콘 자리)', () => {
    expect(characterFaceUrl('docent-2', files)).toBe('/assets/g/chr-2/docent-2-face.webp');
    expect(characterFaceUrl('docent-1', files)).toBeNull();
    expect(characterFaceUrl(null, files)).toBeNull();
    expect(studentFaceImages(files)).toEqual({
      'student-m-03': '/assets/g/chr-2/student-m-03-face.webp',
      'student-f-01': '/assets/g/chr-2/student-f-01-face.webp',
    });
    // 지금(승인 전)은 하나도 없다
    expect(studentFaceImages()).toEqual({});
  });
});
