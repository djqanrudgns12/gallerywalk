/**
 * 캐릭터 목록 한 곳(PRD_V2 §3.4·W-10, M4-9 — 2026-11-13 사용자 결정). 순수 자료와 함수, 외부 패키지 없음.
 *
 * - 관람객 12명: 학생 남 5(`student-m-01`~`05`) · 학생 여 5(`student-f-01`~`05`) · 교사 남 1(`teacher-m`) · 교사 여 1(`teacher-f`).
 *   학생은 입장할 때 10명 가운데 고르고, 교사는 교사 화면에서 둘 가운데 고른다.
 * - 도슨트 3명(`docent-1`~`3`): 서로 다른 인물, 같은 동작 세트. 관람객이 아니라 함께 관람 약속(`CharacterIdSchema`)에는 없다.
 * - 몸 틀은 둘뿐이다: 학생 1.15m·2.5등신, 어른 1.45m·3등신(교사·도슨트). 사람마다 얼굴·머리·옷만 다르고 뼈대·클립 이름
 *   (`idle`·`walk`·`run`·`wave`)은 같다. 틀 × 성별 넷(`BODY_KEYS`)이 몸 수치(`CHAR_ARM_SPREAD_RAD` 등)의 열쇠이고,
 *   키 틀(`BodyBuild`)이 `CHAR_HEIGHT_M`·`CHAR_WAVE`의 열쇠다. 넷의 이름은 판 1 캐릭터 파일(`chr-1/<몸 틀>.glb`)과 같다.
 * - 옛 ID `student-m`·`student-f`는 판 1 옛 앱과 기기 저장 값이 아직 보낸다 → `student-m-01`·`student-f-01`의 별칭으로 받는다.
 */

/** 몸 틀 열쇠(틀 × 성별). 판 1의 관람객 ID 넷과 같은 이름이라 옛 앱에 보낼 때도 이 값을 쓴다 */
export const BODY_KEYS = ['student-m', 'student-f', 'teacher-m', 'teacher-f'] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

/** 키 틀: 학생 / 어른(교사·도슨트) — `CHAR_HEIGHT_M`·`CHAR_WAVE`의 열쇠 */
export type BodyBuild = 'student' | 'teacher';

export const STUDENT_MALE_IDS = [
  'student-m-01',
  'student-m-02',
  'student-m-03',
  'student-m-04',
  'student-m-05',
] as const;
export const STUDENT_FEMALE_IDS = [
  'student-f-01',
  'student-f-02',
  'student-f-03',
  'student-f-04',
  'student-f-05',
] as const;
/** 입장 화면 고르기 순서(번호 1~10): 남 다섯 줄 → 여 다섯 줄 */
export const STUDENT_CHARACTER_IDS = [...STUDENT_MALE_IDS, ...STUDENT_FEMALE_IDS] as const;
export const TEACHER_CHARACTER_IDS = ['teacher-m', 'teacher-f'] as const;
/** 관람객 12명(학생 10 + 교사 2) */
export const VISITOR_CHARACTER_IDS = [...STUDENT_CHARACTER_IDS, ...TEACHER_CHARACTER_IDS] as const;

export type StudentCharacterId = (typeof STUDENT_CHARACTER_IDS)[number];
export type TeacherCharacterId = (typeof TEACHER_CHARACTER_IDS)[number];
export type VisitorCharacterId = (typeof VISITOR_CHARACTER_IDS)[number];

/** 옛 ID → 새 ID(판 1 옛 앱·기기 저장 값) */
export const LEGACY_CHARACTER_ALIASES = {
  'student-m': 'student-m-01',
  'student-f': 'student-f-01',
} as const satisfies Readonly<Record<string, StudentCharacterId>>;
export type LegacyCharacterAlias = keyof typeof LEGACY_CHARACTER_ALIASES;

/** 함께 관람이 받는 값: 새 ID 12개 + 옛 별칭 2개(`CharacterIdSchema`가 이 목록으로 만든다) */
export const ACCEPTED_CHARACTER_IDS = [...VISITOR_CHARACTER_IDS, 'student-m', 'student-f'] as const;
export type AcceptedCharacterId = (typeof ACCEPTED_CHARACTER_IDS)[number];

export const DOCENT_IDS = ['docent-1', 'docent-2', 'docent-3'] as const;
export type DocentId = (typeof DOCENT_IDS)[number];

/** 도슨트 → 기본 자리(배치 `npcSpots`의 id) */
export const DOCENT_HOME_SPOTS = {
  'docent-1': 'docent-plaza',
  'docent-2': 'docent-hall',
  'docent-3': 'docent-room',
} as const satisfies Readonly<Record<DocentId, string>>;

/** 몸이 있는 모든 ID(관람객·옛 별칭·도슨트) */
export type CharacterKey = AcceptedCharacterId | DocentId;

/**
 * 도슨트의 몸 틀: 모두 어른 틀. 성별은 시안(`.local/art/m0/CAST_BIBLE.md` 도슨트01 젊은 여·02 중년 남·03 50대 여)을 따른다.
 * 자기 파일이 오기 전에는 이 틀의 판 1 파일로 대신 보이는데, 실내에서 함께 보이는 홀(2)·전시실(3)이 서로 다르다.
 */
const DOCENT_BODY = {
  'docent-1': 'teacher-f',
  'docent-2': 'teacher-m',
  'docent-3': 'teacher-f',
} as const satisfies Readonly<Record<DocentId, BodyKey>>;

const has = <T extends string>(list: readonly T[], v: string): v is T =>
  (list as readonly string[]).includes(v);

export const isLegacyCharacterAlias = (v: string): v is LegacyCharacterAlias =>
  v === 'student-m' || v === 'student-f';
export const isStudentCharacterId = (v: string): v is StudentCharacterId => has(STUDENT_CHARACTER_IDS, v);
export const isTeacherCharacterId = (v: string): v is TeacherCharacterId => has(TEACHER_CHARACTER_IDS, v);
export const isDocentId = (v: string): v is DocentId => has(DOCENT_IDS, v);

/** 옛 별칭을 새 ID로(새 ID는 그대로) */
export const normalizeCharacterId = (id: AcceptedCharacterId): VisitorCharacterId =>
  isLegacyCharacterAlias(id) ? LEGACY_CHARACTER_ALIASES[id] : id;

/** 기기 저장 값 등 바깥 글 → 학생 캐릭터(옛 별칭은 새 ID로). 학생 ID가 아니면 null */
export const toStudentCharacterId = (raw: string): StudentCharacterId | null =>
  isLegacyCharacterAlias(raw) ? LEGACY_CHARACTER_ALIASES[raw] : isStudentCharacterId(raw) ? raw : null;

/** 몸 틀 열쇠: 학생은 앞 9글자(`student-m`·`student-f`), 교사는 그대로, 도슨트는 정한 틀 */
export const bodyOf = (id: CharacterKey): BodyKey => {
  if (isDocentId(id)) return DOCENT_BODY[id];
  if (isTeacherCharacterId(id)) return id;
  return id.startsWith('student-f') ? 'student-f' : 'student-m';
};

/** 키 틀: 학생 / 어른(교사·도슨트) */
export const buildOf = (id: CharacterKey): BodyBuild =>
  bodyOf(id).startsWith('student') ? 'student' : 'teacher';

/** 학생 캐릭터의 번호(고르기 순서 1~10) */
export const studentNumber = (id: StudentCharacterId): number => STUDENT_CHARACTER_IDS.indexOf(id) + 1;

/** 자리 id → 그 자리에 기본으로 서는 도슨트. 기본 자리가 아니면 null */
export const docentAtSpot = (spotId: string): DocentId | null =>
  DOCENT_IDS.find(d => DOCENT_HOME_SPOTS[d] === spotId) ?? null;
