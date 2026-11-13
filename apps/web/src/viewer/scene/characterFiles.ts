import {
  bodyOf,
  type CharacterKey,
  isDocentId,
  normalizeCharacterId,
  STUDENT_CHARACTER_IDS,
  type StudentCharacterId,
} from '@gallery/core/types';

/**
 * 캐릭터 ID → glb 주소(M4-9, 규격 `tools/assets/spec/characters.md`). 순수 함수라 `Character.tsx`(three)를 부르지 않는 곳도 쓴다.
 *
 * 운영 서버는 `/assets/g/*`를 오래 캐시하는 정적 파일로 낸다(PLAN §9.6) — 파일 이름에 해시가 없으므로 폴더에 판 번호를 붙인다.
 * - 판 1(`chr-1`): 몸 틀 넷(`student-m`·`student-f`·`teacher-m`·`teacher-f`)의 파일. 아직 자기 파일이 없는 ID는 같은 몸 틀의 이 파일로
 *   대신 보인다(사람마다 얼굴·머리·옷만 다르고 뼈대·키·클립 이름은 같아서 그대로 바꿔 끼울 수 있다).
 * - 판 2(`chr-2`): 그림 세션이 Tripo → `character.mjs`로 만든 15명(`<id>.glb`, 관람객은 `<id>-lod1.glb`도).
 *   들어온 ID를 `CHARACTER_FILES`에 더하기만 하면 그 ID가 제 모습으로 바뀐다.
 */
export const CHARACTER_BASE = '/assets/g/chr-1';
export const CHARACTER_BASE_2 = '/assets/g/chr-2';

/** `chr-2`에 들어온 캐릭터 ID(관람객은 새 ID — 옛 별칭은 01번으로 찾는다). 지금은 없다 */
export const CHARACTER_FILES: ReadonlySet<CharacterKey> = new Set<CharacterKey>([]);

const fileOf = (id: CharacterKey, files: ReadonlySet<CharacterKey>): { base: string; name: string } => {
  const key = isDocentId(id) ? id : normalizeCharacterId(id);
  return files.has(key) ? { base: CHARACTER_BASE_2, name: key } : { base: CHARACTER_BASE, name: bodyOf(id) };
};

/** 몸 glb(뼈대 + `idle`·`walk`·`run`·`wave`) */
export const characterGlbUrl = (
  id: CharacterKey,
  files: ReadonlySet<CharacterKey> = CHARACTER_FILES,
): string => {
  const f = fileOf(id, files);
  return `${f.base}/${f.name}.glb`;
};

/** 먼 거리 LOD(다른 관람객 정점 애니메이션용). 같은 주소 = 같은 몸 묶음(그리기 1회) */
export const characterLodUrl = (
  id: CharacterKey,
  files: ReadonlySet<CharacterKey> = CHARACTER_FILES,
): string => {
  const f = fileOf(id, files);
  return `${f.base}/${f.name}-lod1.glb`;
};

/**
 * 2D 얼굴 그림(쌤유니버스 화풍, 그림 세션 `concept/<id>/face.png` → 승인 뒤 `chr-2/<id>-face.webp`): 입장 화면 고르기 칸·도슨트 대사 카드.
 * 들어온 ID를 `FACE_FILES`에 더하면 그 칸·카드에 얼굴이 보인다. 지금은 없다(사용자 승인 전 — AGENTS §6 "승인된 것만 저장소에")
 */
export const FACE_FILES: ReadonlySet<CharacterKey> = new Set<CharacterKey>([]);

/** 얼굴 그림 주소. 없으면 null(부품이 실루엣·아이콘 자리로 그린다) */
export const characterFaceUrl = (
  id: CharacterKey | null,
  files: ReadonlySet<CharacterKey> = FACE_FILES,
): string | null => {
  if (id === null) return null;
  const key = isDocentId(id) ? id : normalizeCharacterId(id);
  return files.has(key) ? `${CHARACTER_BASE_2}/${key}-face.webp` : null;
};

/** 입장 화면 고르기 칸에 넘길 얼굴 그림 묶음(있는 것만) */
export const studentFaceImages = (
  files: ReadonlySet<CharacterKey> = FACE_FILES,
): Partial<Record<StudentCharacterId, string>> => {
  const out: Partial<Record<StudentCharacterId, string>> = {};
  for (const id of STUDENT_CHARACTER_IDS) {
    const url = characterFaceUrl(id, files);
    if (url) out[id] = url;
  }
  return out;
};
