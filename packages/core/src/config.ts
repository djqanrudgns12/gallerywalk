/**
 * 바뀔 수 있는 값을 모아 둔 한 곳(PRD 0.2-6 `[고정]`, PLAN §17.1).
 * 코드·SQL·셰이더는 숫자를 직접 쓰지 않고 여기서 읽는다(AGENTS.md §3).
 * 서버는 같은 이름의 환경 변수로 덮어쓸 수 있다(`apps/server/src/env.ts`, P3-1).
 */
export const configDefaults = {
  // ── PRD 14장 그대로 ─────────────────────────────────────────
  EXHIBITION_TTL_DAYS: 30,
  ROOM_SPLIT_AT: 12,
  EXHIBITION_SOFT_TARGET: 60,
  MIN_SHORT_SIDE_PX: 300,
  WARN_SHORT_SIDE_PX: 800,
  MAX_IMAGE_MB: 25,
  MAX_AUDIO_MB: 20,
  MAX_ASPECT: 30,
  PDF_MAX_PAGES: 30,
  TEXT_MAX_CHARS: 5000,
  AUDIO_MAX_MIN: 10,
  READ_SCALE_MIN: 0.6,
  PAGE_OVERLAP: 0.05,
  TOUR_SECONDS_PER_ROOM: 40,
  CHANGE_POLL_SEC: 60,
  PIN_MIN_LENGTH: 6, // PRD 4 → 6 (ADR-024, G-17 "글쓰기 앱과 같은 방식")
  PIN_MAX_LENGTH: 8,
  PIN_MAX_FAILS: 5,
  PIN_LOCK_MIN: 10,
  RECENT_EXHIBITIONS_MAX: 5,
  UNDO_DELETE_SEC: 10,
  /** 교사 관리 화면 편집 되돌리기(HT-08): 기억하는 편집 수 */
  UNDO_STACK_MAX: 20,
  /** "지금 삭제" 단추가 잠겨 있는 시간(PRD G-18) · 교사 화면 알림 띠가 떠 있는 시간 */
  DELETE_CONFIRM_SEC: 3,
  TOAST_SEC: 4,
  /** 교사 관리 화면(P5): 입력이 멈추고 저장하기까지 · 길게 누르기 · 끌기 시작 거리 */
  AUTOSAVE_DELAY_MS: 600,
  LONG_PRESS_MS: 500,
  DRAG_START_PX: 8,
  /** 한 번에 놓기 `PUT …/arrangement`(ADR-074): 한쪽(`base`·`rooms`)의 전시실 판 수·작품 ID 수 상한 — 두 쪽을 합쳐도 `JSON_BODY_MAX_KB` 안 */
  ARRANGEMENT_MAX_ROOMS: 50,
  ARRANGEMENT_MAX_IDS: 600,
  /** 수업 탭(HT-07): 지금 관람 수 `GET …/live`를 다시 부르는 간격(초). 탭이 보이고 화면이 앞에 있을 때만 */
  LIVE_TEACHER_POLL_SEC: 10,
  /** 올리기(P5-3): 바쁨·속도 제한 다시 보내기 횟수·간격 · 사전 검사에서 머리만 읽는 바이트 · 소리 길이 읽기 상한 */
  UPLOAD_RETRY_MAX: 4,
  UPLOAD_RETRY_DELAY_MS: 2000,
  UPLOAD_HEAD_BYTES: 262_144,
  AUDIO_PROBE_TIMEOUT_MS: 8000,
  PURGE_DELETED_HOURS: 24,
  /**
   * 정리 작업(PLAN §9.7, `apps/server/src/jobs`): 보관 정리 주기(만료·지우는 중 전시), 지운 작품·남은 asset·임시 정리 주기,
   * 어디에도 붙지 않은 asset을 지우기까지(받는 중 → 행이 붙기 전 틈), 임시 파일을 지우기까지, 한 주기에 종류마다 다루는 수(넘으면
   * ID 순서로 다음 주기에 이어서).
   */
  RETENTION_CLEANUP_INTERVAL_SEC: 60,
  PURGE_CLEANUP_INTERVAL_SEC: 3600,
  ORPHAN_ASSET_HOURS: 2,
  TMP_PURGE_HOURS: 1,
  CLEANUP_BATCH_SIZE: 100,

  // ── 입장·교사 (ADR-023·024·048) ─────────────────────────────
  ENTRY_CODE_DIGITS: 6,
  PIN_IP_MAX_FAILS: 30,
  PIN_GLOBAL_SLOW_AT: 100,
  PIN_GLOBAL_DELAY_MS: 2000,
  CREATE_PER_DEVICE_DAY: 5,
  CREATE_PER_IP_DAY: 30,
  CREATE_GLOBAL_DAY: 200,
  START_CODE_REQUIRED: true,
  /**
   * 학생 경로 속도 칸(PLAN §9.2 학생 표, ADR-062): `[한도, 창 초]`. 한 반이 한 IP(학교 공용)로 들어와도 막히지 않게 IP 칸은 넉넉히.
   * 틀린 입장 코드는 기기마다 먼저 세어 그 기기만 막고(`badCodeDevice`), 학교 전체가 함께 쓰는 IP 칸은 넉넉히 둔다(`badCodeIp`,
   * G-24 — 한 학생의 연타가 학교 전체를 막지 않게, ADR-070). 진단·기기 보고(`diag*`)는 기기 하나가 관람마다 두어 번 보낸다.
   */
  PUBLIC_RATE: {
    viewDevice: [30, 60],
    viewIp: [600, 60],
    badCodeDevice: [20, 600],
    badCodeIp: [300, 600],
    diagDevice: [6, 600],
    diagIp: [1200, 600],
    versionDevice: [10, 60],
    registerIp: [200, 600],
    renameVisitor: [10, 600],
    reactVisitor: [120, 600],
    reactIp: [3000, 600],
  },

  // ── 글자 수 한도 (PRD 4장·PLAN §7. 전시실 30·200은 PLAN §7.4, 나머지는 [추천]) ─
  EXHIBITION_TITLE_MAX_CHARS: 40,
  SUBTITLE_MAX_CHARS: 80,
  SCHOOL_NAME_MAX_CHARS: 40,
  CLASS_NAME_MAX_CHARS: 20,
  ROOM_TITLE_MAX_CHARS: 30,
  ROOM_INTRO_MAX_CHARS: 200,
  ARTWORK_TITLE_MAX_CHARS: 60,
  AUTHOR_MAX_CHARS: 40,
  CAPTION_MAX_CHARS: 120,
  DESCRIPTION_MAX_CHARS: 1000,

  // ── 반응 (G-07, ADR-029·049) ────────────────────────────────
  MEMO_MAX_CHARS: 60,
  NICKNAME_MAX_CHARS: 12,
  CONSENT_VERSION: '2026-11',
  REACTION_PER_VISITOR_10MIN: 120,
  REACTION_OUTBOX_MAX: 200,

  // ── 공간 (PRD 5장, PLAN §4) ────────────────────────────────
  MODULE_UNIT_M: 2,
  WALL_HEIGHT_M: 4,
  WALL_THICKNESS_M: 0.3,
  DOOR_WIDTH_M: 2,
  DOOR_HEIGHT_M: 2.8,
  EYE_HEIGHT_M: 1.5,
  CAMERA_HEIGHT_M: 1.55,
  FRAME_GAP_MIN_M: 1.2,
  CORNER_MARGIN_M: 0.8,
  DOOR_MARGIN_M: 0.6,
  WALL_MAX_LEN_M: 16,
  ROOM_MIN_W_M: 8,
  ROOM_MIN_D_M: 6,
  CORRIDOR_WIDTH_M: 4,
  PART_GAP_M: 2,
  PART_STAGGER_M: 4,
  CAMERA_WALL_CLEARANCE_M: 0.4,
  PATH_FILLET_MAX_M: 0.8,
  /** 꺾인 곳 원호 반지름 ≤ 이웃 선분의 이 비율(§4.8 "40%"), 아주 날카롭게 꺾이면 접선 길이 ≤ 이 비율 */
  PATH_FILLET_SEGMENT_RATIO: 0.4,
  PATH_FILLET_TANGENT_RATIO: 0.45,
  PATH_SAMPLE_M: 0.1,
  /** 액자 뒷면을 벽 회반죽 면에서 띄우는 거리. 몰딩·징두리 판벽(최대 7cm)보다 앞에 걸리게 */
  FRAME_HANG_OFFSET_M: 0.08,
  FEATURED_SCALE: 1.3,
  MAT_RATIO: 0.06,
  MAT_MIN_M: 0.05,
  MAT_MAX_M: 0.14,
  MAT_FEATURED_SCALE: 1.4,
  /** 작품 가장자리 평균 밝기가 이 이상이면 어두운 매트(PRD 6.5) */
  MAT_DARK_EDGE_LUMA: 0.8,
  /** 배치 엔진 판(§4.10). 2 = 미술관 외관·이젤·작품 1.35배(ADR-057), 3 = 계단 경사에 디딤판 수(`slope.steps`) */
  ALGO_VERSION: 3,
  /** 벽에 거는 액자 바깥 높이 상한(벽 4m − 아래 0.4m − 위 여유 0.4m). 넘으면 비율 그대로 줄인다(ADR-057) */
  FRAME_MAX_OUTER_H_M: 3.2,
  /**
   * 이젤(ADR-057): 관 작품이 `EASEL_MIN_ITEMS` 이상이면 순서 끝의 작품 몇 점(크기별 수)을 방 가운데 이젤에.
   * 소리·파노라마·긴 세로·대표작은 이젤에 놓지 않는다(끝에서부터 연속으로 맞는 것만).
   */
  EASEL_MIN_ITEMS: 3,
  EASEL_COUNT: { S: 1, M: 1, L: 2 },
  /** 이젤 위 액자 바깥 크기 상한(넘으면 비율 그대로 줄임)·액자 아래 끝 높이 */
  EASEL_MAX_OUTER_M: { w: 1.7, h: 1.6 },
  EASEL_LEDGE_Y_M: 0.78,
  /**
   * 이젤 자리: 들어온 벽(N)에서 방 깊이의 이 비율, 여러 개면 가운데 기준 간격. 이젤이 있는 관은 깊이를 이만큼 이상으로.
   * 이젤이 있으면 가운데 벤치는 이젤 뒤(대표 벽 쪽)로. 카메라는 키 큰 설비 앞까지만 물러선다(computeLayout).
   */
  EASEL_DEPTH_RATIO: 0.45,
  EASEL_SPACING_M: 2.4,
  EASEL_ROOM_MIN_D_M: 8,
  EASEL_BENCH_GAP_M: 1.5,
  /** 길 찾기(`route.ts`): 두 점 둘레로 볼 여유, 설비 모서리 꼭짓점을 바깥으로 띄우는 거리 */
  ROUTE_SEARCH_PAD_M: 6,
  ROUTE_CORNER_OFFSET_M: 0.08,
  /** 카메라 길(키 큰 설비만 피함)은 몸이 없으니 설비 실제 바닥에서 이만큼만 떨어지면 된다(걷기 여유 대신) */
  ROUTE_CAMERA_CLEARANCE_M: 0.15,
  /** 관 크기 표(PRD 5.2·PLAN §4.4): 작품 수(대표 포함) ≤ S_MAX → S, ≤ M_MAX → M, 그 위 L */
  ROOM_SIZE_S_MAX: 4,
  ROOM_SIZE_M_MAX: 8,
  /** 방 깊이 ÷ 폭 상한(넘으면 폭을 2m씩 늘림, PLAN §4.4-4) */
  ROOM_MAX_DW_RATIO: 2,
  /** 바깥 높이가 이보다 크면 한가운데 1.5m 대신 아래 끝을 `HIGH_FRAME_BOTTOM_M`에(§4.5) */
  HIGH_FRAME_LIMIT_M: 2.6,
  HIGH_FRAME_BOTTOM_M: 0.4,
  /** 명판: 액자의 걷는 방향 뒤쪽(지나온 쪽)으로 띄우는 거리·한가운데 높이(§4.5) */
  LABEL_OFFSET_M: 0.15,
  LABEL_HEIGHT_M: 1.3,
  /**
   * 그릴 때 명판을 액자에서 벽을 따라 더 떨어뜨리는 거리(배치 좌표는 그대로 — 저장된 배치에도 적용). 액자 앞면이 벽에서
   * 13cm 떠 있어 비스듬히 보면 명판 안쪽을 가렸다(V-57). 이젤 명판은 받침 아래라 옮기지 않는다.
   */
  LABEL_FRAME_GAP_M: 0.08,
  /** 명판 판 크기(m, 그리기·작품 앞 카메라 맞춤이 함께 씀) */
  LABEL_PLATE_M: { w: 0.3, h: 0.15 },
  /**
   * 작품 앞 카메라: 명판 먼 끝이 보이는 가로의 이 비율 밖이면 액자와 명판을 함께 감싸 다시 맞춘다
   * (휴대폰·태블릿 세로에서 명판이 화면 끝에서 잘리던 것, 2026-11-14 e2e 캡처). 가로가 넉넉한 화면은 그대로
   */
  LABEL_FIT_MARGIN: 0.94,
  /** 정지 지점: 전시실 소개는 들어가는 문 안쪽, 입구 홀은 홀 입구 안쪽(§4.7) */
  INTRO_STOP_INSIDE_M: 1.2,
  HALL_STOP_INSIDE_M: 1.5,
  /** 관 사이 경로의 문 앞뒤 경로점 거리(§4.8) */
  DOOR_PATH_OFFSET_M: 1.2,
  /** 걸을 수 있는 영역 = 벽에서 이만큼 안쪽(§4.8 `pathClear`) */
  WALKABLE_WALL_MARGIN_M: 0.3,
  /** 글 카드의 세로 종이 비율(가로 ÷ 세로, A4) */
  TEXTCARD_ASPECT: 0.707,
  /** 형태 경계(r = 가로 ÷ 세로, PRD 6.4). 파노라마·가로는 이 값을 "초과"해야, 정사각·세로는 "이상"이면 그 형태 */
  FORM_PANORAMA_MIN_R: 2.2,
  FORM_LANDSCAPE_MIN_R: 1.2,
  FORM_SQUARE_MIN_R: 0.83,
  FORM_PORTRAIT_MIN_R: 0.45,
  /** 파일 이름에 들어 있으면 "글 많음"을 켜는 낱말(PLAN §5.5) */
  TEXT_HEAVY_NAME_WORDS: [
    '기사',
    '포스터',
    '웹툰',
    '만화',
    '신문',
    '카드뉴스',
    '보고서',
  ] as readonly string[],
  /** 형태별 벽 기준 크기(m, PRD 6.4 × 1.35 — ADR-057 "작품을 크게"). 한 변만 정하면 나머지는 비율로 */
  FORM_BASE_M: {
    PANORAMA: { w: 3.24 },
    LANDSCAPE: { w: 2.16 },
    SQUARE: { w: 1.62, h: 1.62 },
    PORTRAIT: { h: 1.89 },
    TALL: { h: 2.43 },
    MULTIPAGE: { h: 1.89 },
    TEXTCARD: { h: 1.89 },
    SOUND: { w: 0.5, h: 0.35 },
  },
  /** 긴 세로·파노라마가 벽에서 보이는 창의 비율(가로 ÷ 세로) */
  TALL_WINDOW_RATIO: 0.62,
  PANORAMA_WINDOW_RATIO: 1.6,

  // ── 카메라·연출 (PRD 8장, PLAN §6) ─────────────────────────
  STOP_FILL: 0.55,
  STOP_FILL_WIDTH: 0.8,
  ZOOM_FILL: 0.85,
  VFOV_DEG: 50,
  VFOV_MAX_DEG: 65,
  /** 상한 화각·상한 거리에서도 액자가 잘릴 때만 쓰는 마지막 상한 */
  VFOV_HARD_MAX_DEG: 80,
  LOOK_YAW_DEG: 20,
  LOOK_PITCH_DEG: 8,
  ZOOM_DIM: 0.7,
  ZOOM_POOL_BOOST: 1.35,
  ZOOM_MAX_SCALE: 3,
  /** 크게 볼 때 화면 아래 캡션 카드가 가리는 비율(세로 화면만 — 가로 휴대폰은 캡션이 오른쪽 패널, PRD 9.5) */
  ZOOM_CAPTION_INSET: 0.24,
  ZOOM_HI_AT_SCALE: 1.5,
  PINCH_LOCK_SCALE: 1.05,
  IDLE_DIM_SEC: 3,
  /** 걷기 키 안내를 처음 보이는 시간(그 사이 움직이면 바로 숨김, V-54) */
  WALK_HINT_SEC: 8,
  /** 위 줄 투명도(PLAN §7.3): 움직이는 동안 · 입력 없이 `IDLE_DIM_SEC` 지난 뒤 */
  TOP_BAR_OPACITY: { moving: 0.5, idle: 0.35 },
  MICRO_MOTION_SETTLE_SEC: 2,
  /** 액자에 마우스를 올리면 그 빛 웅덩이를 `T_HOVER`에 걸쳐 이만큼 밝힌다(PRD 8.2, V-40) */
  HOVER_POOL_BOOST: 1.22,
  /**
   * 작은 움직임(PRD 8.3·10.4, ADR-013, V-40): 이동 중과 도착 뒤 `MICRO_MOTION_SETTLE_SEC`까지만, 실내에서만.
   * 먼지 수(단계별, '낮음' 0) · 먼지가 되풀이되는 카메라 둘레 상자 한 변(m) · 1m 거리 점 크기(CSS px) · 불투명도 ·
   * 떠도는 빠르기(m/s) · 빛 흔들림 세기(빛 웅덩이 ±비율)·빠르기(Hz 둘) · 켜질 때 걸리는 시간(초)
   */
  MICRO_MOTION: {
    dustCount: { HIGH: 90, MEDIUM: 40, LOW: 0 },
    dustBoxM: 7,
    dustSizePx: 7,
    dustOpacity: 0.3,
    dustDriftMps: 0.05,
    /** 축별 흔들림 빠르기(rad/s), Y·Z축 씨앗 위상(X축은 한 바퀴) */
    dustWobbleRadPerSec: [1, 0.7, 0.8],
    dustWobbleSeedPhaseRad: [3.1, 5],
    /** 떠도는 방향(X·Y·Z)과 상자 가장자리·눈앞에서 사라지는 거리 */
    dustDriftDirection: [1, -0.6, 0.7],
    dustFadeBoxRatio: [0.3, 0.5],
    dustNearFadeM: [0.4, 1],
    dustMinDepthM: 0.25,
    shimmerAmp: 0.05,
    shimmerHz: [0.37, 0.91],
    /** 두 사인의 혼합 비율과 두 번째 사인의 위상 배율 */
    shimmerMix: [0.6, 0.4],
    shimmerPhaseRatio: 1.7,
    fadeInSec: 0.4,
  },
  /** 아주 약한 가장자리 어둡게(PRD 10.3): 단계별 모서리 어둡기('낮음' 끔) · 어두워지기 시작하는 반지름(가운데 0 · 모서리 ≈ 1.41) */
  VIGNETTE: { strength: { HIGH: 0.2, MEDIUM: 0.2, LOW: 0 }, inner: 0.6 },
  /** PRD 8.2 시간 표(초) */
  T_ENTER: 1.6,
  T_STOP_MIN: 0.9,
  T_STOP_MAX: 1.4,
  T_STOP_PER_M: 0.12,
  T_ROOM_MIN: 1.6,
  T_ROOM_MAX: 2.2,
  T_ROOM_PER_M: 0.04,
  T_ZOOM: 0.8,
  T_ZOOM_CAPTION_START: 0.55,
  T_UNZOOM: 0.6,
  T_ZOOM_NEXT: 1.0,
  T_PAGE: 0.35,
  T_HOVER: 0.2,
  T_SHEET: 0.3,
  T_REDUCED: 0.3,
  T_TEXTURE_SWAP: 0.2,
  T_HTML_SWAP: 0.12,
  T_LOOK_RETURN: 0.6,
  /** 출발 가속 짧게·도착 감속 길게 (PLAN §4.8) */
  MOVE_EASE: [0.45, 0, 0.15, 1] as const,

  // ── 쪽 나눔 (PRD 6.7, ADR-007·047) ─────────────────────────
  READ_LINE_PITCH_MIN_PX: 18,
  READ_REF_WIDTH_TALL: 720,
  READ_REF_WIDTH_DOC: 1240,
  CUT_SEARCH_RATIO: 0.08,
  CUT_MIN_PAGE_RATIO: 0.6,
  /** 나눠서 얻는 배율이 한 장 맞춤의 이 배를 넘을 때만 나눈다(§5.6, 아니면 확대 + 회전 안내) */
  PAGE_SPLIT_MIN_GAIN: 1.02,
  /**
   * 한 장 맞춤 배율이 읽기 기준의 이 배 이상이면(나눔 대상이어도 긴 세로·파노라마가 아니면) 한 장으로 두고 확대로 읽는다.
   * 데스크톱 A4 한 장(PRD 15.1-5, V-27): 보통 글자(줄 간격 ≈ 83px)는 한 장, 아주 촘촘한 글은 그래도 나눈다
   */
  PAGE_SINGLE_READ_TOLERANCE: 0.8,
  /** 화면을 돌리면 짧은 축 맞춤 배율이 이 배를 넘게 커지는 글 문서만 회전 안내(ADR-047) */
  ROTATE_HINT_MIN_GAIN: 1.2,
  /** 붙여넣은 글의 시 판정(§5.7): 줄 수 하한, 짧은 줄 글자 수, 짧은 줄 비율 */
  POEM_MIN_LINES: 4,
  POEM_SHORT_LINE_CHARS: 20,
  POEM_SHORT_LINE_RATIO: 0.7,
  TEXT_MIN_PX_PHONE: 18,
  TEXT_MIN_PX_TABLET: 20,
  TEXT_MIN_PX_DESKTOP: 22,
  TEXT_LINE_CHARS: 32,

  // ── 파생 이미지 (PRD 6.6, ADR-006) ──────────────────────────
  THUMB_PX: 512,
  WALL_PX: 1600,
  /** 글 카드·소리 명판을 기기가 그리는 캔버스 긴 변(px, PLAN §5.7) — 벽 거리에서 본문이 읽히고 GPU는 작게 */
  TEXT_CARD_PX: 1024,
  WALL_LO_PX: 1024,
  ZOOM_PX: 2048,
  ZOOM_HI_PX: 4096,
  STRIP_PX: 2048,
  STRIP_SHORT_MAX_PX: 1440,
  PDF_RENDER_PX: 2400,
  PDF_RENDER_JPEG_Q: 0.92,
  WEBP_Q_THUMB: 75,
  WEBP_Q_WALL: 82,
  WEBP_Q_WALL_LO: 80,
  WEBP_Q_ZOOM: 85,
  PROFILE_BIN_PX: 8,
  /** 줄 활동 배열 칸 수 상한(넘으면 칸 폭을 8px의 정수배로 늘림) */
  PROFILE_MAX_BINS: 4096,
  LINE_PITCH_MAX_SHORT_PX: 2400,
  /** 가장자리 밝기를 재는 띠(짧은 변이 아니라 각 변의 비율) */
  ANALYSIS_EDGE_RATIO: 0.04,
  /** 줄 활동량에서 빼는 양옆 테두리(PLAN §5.4) */
  ANALYSIS_BORDER_RATIO: 0.08,
  /** 자기상관 봉우리를 줄 간격으로 받는 최소 신뢰도 */
  LINE_PITCH_MIN_CONFIDENCE: 0.6,
  /** 가장 높은 봉우리의 이 비율 이상인 첫 봉우리 = 기본 주기(배수 주기를 고르지 않게) */
  LINE_PITCH_PEAK_RATIO: 0.9,

  // ── 입력 (PLAN §6.9) ───────────────────────────────────────
  TAP_MAX_PX: 10,
  /** 크게 보는 중 한 손가락으로 이만큼 아래로 쓸면 닫는다(PRD G-03) */
  ZOOM_SWIPE_CLOSE_PX: 80,
  /**
   * 자유 관람(ADR-057) 캐릭터: 걷기·뛰기 속도(m/s), 가속·감속(m/s²), 도는 빠르기(rad/s), 키(학생·선생님, m).
   * 안내 이동("다음 작품으로")은 걷기 속도 × `GUIDE_SPEED_SCALE`로, 경로 끝 `GUIDE_ARRIVE_M` 안이면 도착.
   * 작품 앞에 서는 자리: 화면 맞춤 카메라 자리에서 작품 쪽으로 `VIEW_STAND_FORWARD_M`, 옆으로 `VIEW_STAND_SIDE_M`.
   */
  CHAR_WALK_MPS: 1.15,
  /** 느린 프레임의 경과 시간은 보존하되 충돌 계산은 이 간격 이하로 나눈다(초). */
  WALK_PHYSICS_STEP_SEC: 0.1,
  CHAR_RUN_MPS: 3.2,
  CHAR_ACCEL_MPS2: 9,
  CHAR_DECEL_MPS2: 12,
  CHAR_TURN_RAD_S: 11,
  /** 키 틀별(`domain/characters.ts` `buildOf`: 학생 / 어른 = 교사·도슨트). 캐릭터 파일이 이 키로 만들어진다 */
  CHAR_HEIGHT_M: { student: 1.15, teacher: 1.45 },
  /**
   * 위팔을 몸 바깥으로 더 벌리는 각(rad, 몸 틀별 — `domain/characters.ts` `bodyOf`, 같은 틀의 사람은 같은 값): Tripo 동작 프리셋은
   * 손을 엉덩이 옆에 붙여 퍼진 치마를 뚫는다. 동작을 적용한 뒤 어깨에서 몸 앞쪽 축으로 돌린다(`Character.tsx`).
   */
  CHAR_ARM_SPREAD_RAD: { 'student-m': 0, 'student-f': 0.16, 'teacher-m': 0, 'teacher-f': 0 },
  /**
   * 걷기·뛰기 클립 재생 배속 = 지금 빠르기 ÷ 클립의 땅 빠르기(glb `groundMps`, 변환 도구가 잼)를 이 범위로 자른다.
   * Tripo 프리셋은 보폭이 짧아(학생 걷기 약 0.36m/s, 교사 0.6m/s) 끝까지 맞추면 다리가 너무 빨리 논다 — 상한을 넘는 만큼은 발이 조금
   * 미끄러진다. 걷기 빠르기 1.15m/s(박물관 걸음)에서 교사는 거의 맞고 학생은 약 1.6배 미끄러짐(예전 1.5m/s·배속 1에서는 4배).
   */
  CHAR_CLIP_RATE: { walkMin: 0.5, walkMax: 2.0, runMin: 0.6, runMax: 1.4 },
  /** 발 바닥 높이를 따라가는 빠르기(1/s). 계단은 디딤판마다 평평(`footFloorAt`)이라 빨리 따라가야 단 앞에서 파묻히지 않는다(약 30ms) */
  CHAR_FLOOR_FOLLOW: 35,
  /**
   * 사람끼리 겹치지 않게: 몸 반지름(m). 다른 사람과 두 반지름보다 가까우면 `CHAR_CROWD_PUSH_PER_S` × 겹친 깊이만큼(초당, 상한
   * `CHAR_CROWD_PUSH_MAX_MPS`) 밀려나고, 밀리는 방향의 옆으로 `CHAR_CROWD_SIDESTEP` 비율만큼 비켜 돌아간다(마주 막혀 서지 않게).
   */
  CHAR_BODY_RADIUS_M: 0.28,
  CHAR_CROWD_PUSH_PER_S: 18,
  CHAR_CROWD_PUSH_MAX_MPS: 2.4,
  CHAR_CROWD_SIDESTEP: 0.6,
  /** 발밑 그늘(부드러운 원판): 반지름(키에 곱함)·가운데 짙기. 떠오르면 작아지고 옅어진다 */
  CHAR_SHADOW_RADIUS_RATIO: 0.27,
  CHAR_SHADOW_OPACITY: 0.5,
  /**
   * 손 흔들기(인사): 엔진이 오른팔을 겨눈다 — 위팔은 캐릭터 기준 `upper`(바깥 x·위 y·앞 z, 오른쪽이 바깥) 쪽으로, 아래팔은 위를 향해
   * `swingCenterRad` 둘레로 `swingRad`·`hz` 좌우로(`CHAR_WAVE_SEC` 동안, 앞뒤 `easeSec` 부드럽게). 아기자기한 비율이라 팔이 짧아
   * 손을 머리 위로 뻗지 못하므로 손이 큰 머리 옆 바깥에 오게 한다. 광장에 처음 서고 `CHAR_WAVE_DELAY_SEC` 뒤 한 번, 가만히 서 있을 때
   * 다른 사람이 `CHAR_GREET_M` 안으로 새로 들어오면 한 번(`CHAR_GREET_COOLDOWN_SEC`에 한 번까지). 걸으면 바로 멈춘다.
   * (Tripo `wave_goodbye_01`은 엉덩이까지 움직이며 웅크려서 쓰지 않는다.)
   */
  CHAR_WAVE_SEC: 2.4,
  CHAR_WAVE: {
    // 학생은 머리가 커서 손이 머리에 닿지 않게 위팔을 더 옆으로·아래팔을 바깥으로
    student: { upper: [0.97, 0.18, 0.18], swingCenterRad: 0.6, swingRad: 0.4, hz: 2.2, easeSec: 0.35 },
    teacher: { upper: [0.75, 0.65, 0.1], swingCenterRad: 0.3, swingRad: 0.42, hz: 2.2, easeSec: 0.35 },
  },
  CHAR_WAVE_DELAY_SEC: 1,
  CHAR_GREET_M: 1.6,
  CHAR_GREET_COOLDOWN_SEC: 15,
  /**
   * 다른 관람객 정점 애니메이션(`peerBody.ts`): 걷기·뛰기 클립을 몇 장면으로 굽는가(사이는 섞음), 텍스처 너비 상한(꼭짓점을 이 폭으로 접음).
   * 반정밀도 RGBA 두 장(자리·법선) — 2.5천 꼭짓점·41장면이면 종류당 약 2MB, 그 종류가 처음 보일 때만 굽는다.
   */
  /**
   * 외관 접촉 그늘(`ExteriorContact`): 정면 벽 밑·계단 안쪽 모서리 흐린 띠(깊이 m·짙기), 현관 기둥 밑 둥근 그늘(기둥 지름 배율·짙기).
   * 바닥 위로 `liftM` 띄운다. Blender 굽기에 접촉 그림자가 들어오면 지운다.
   */
  EXTERIOR_CONTACT: {
    liftM: 0.012,
    wallDepthM: 1.2,
    stepDepthM: 0.22,
    stepInsetM: 0.25,
    stripOpacity: 0.38,
    columnScale: 1.7,
    columnOpacity: 0.45,
    /** 정문: 벽 면에서 안쪽 거리, 위 띠 높이, 옆 띠 폭(m) */
    doorInsetM: 0.03,
    doorHeadM: 1.2,
    doorSideM: 0.45,
  },
  /**
   * 광장·현관 포장 줄눈(`M_Paving*` 재질 셰이더): 세계 좌표 기준 돌판 `slabW`×`slabD`(m, 줄마다 반 칸 엇갈림), 줄눈 폭 `jointM`,
   * 줄눈 짙기 `dark`, 판마다 밝기 흔들림 `toneVar`(±).
   */
  PAVING_JOINT: { slabW: 1.0, slabD: 0.5, jointM: 0.01, dark: 0.32, toneVar: 0.05 },
  /**
   * 외관 석재 잔결(`M_Stone*`·`M_Ashlar*` 재질 셰이더, Antigravity 비평: 기둥·벽이 매끈한 단색이라 석고 모형 같다): 세계 좌표 값 잡음
   * 두 겹(성긴 `coarse`·고운 `fine`, 1/m)으로 밝기를 ±`tone`, 거칠기를 ±`rough` 흔들고, 같은 높이로 법선을 `bump`만큼 기울인다(요철).
   * Blender 굽기에 석재 질감이 들어오면 지운다.
   */
  STONE_GRAIN: { coarse: 1.6, fine: 9, tone: 0.11, rough: 0.24, bump: 0.6 },
  PEER_VAT_FRAMES: { walk: 24, run: 16 },
  PEER_VAT_TEX_W: 1024,
  /** 다른 관람객이 서기 ↔ 걷기로 바뀔 때 섞는 빠르기(1/s) */
  PEER_VAT_BLEND_PER_S: 6,
  /**
   * 점프(놀이): 뛰어오르는 빠르기(m/s)와 중력(m/s²) — 높이 = v²/2g ≈ 0.46m, 떠 있는 시간 ≈ 0.51초.
   * 벽 부딪힘: 벽 쪽으로 막힌 빠르기가 `CHAR_BUMP_MIN_MPS` 이상이고 가려던 빠르기의 `CHAR_BUMP_MIN_RATIO` 이상이면(거의 정면)
   * `CHAR_BUMP_PAUSE_SEC` 동안 손 입력을 받지 않고, 그 앞부분 `CHAR_BUMP_RECOIL_PART` 동안 `CHAR_BUMP_RECOIL_M`만큼 뒤로 밀려난다.
   * 비스듬히 스치면 지금처럼 벽을 따라 미끄러진다.
   */
  CHAR_JUMP_SPEED_MPS: 3.6,
  CHAR_GRAVITY_MPS2: 14,
  CHAR_BUMP_MIN_MPS: 0.9,
  CHAR_BUMP_MIN_RATIO: 0.9,
  CHAR_BUMP_PAUSE_SEC: 0.45,
  CHAR_BUMP_RECOIL_M: 0.22,
  CHAR_BUMP_RECOIL_PART: 0.4,
  /**
   * 관람 예절(놀이): 실내에서 `MANNER_RUN_SEC` 넘게 뛰거나 `MANNER_JUMP_WINDOW_SEC` 안에 `MANNER_JUMP_COUNT`번 뛰어오르면
   * 도슨트 말풍선으로 알려 준다(`MANNER_NOTICE_SEC` 동안 보임). 알린 뒤 `MANNER_SLOW_SEC` 동안은 뛰기가 걷기로 바뀌고,
   * 같은 알림은 `MANNER_COOLDOWN_SEC` 안에 다시 하지 않는다. 광장(바깥)에서는 마음껏.
   */
  MANNER_RUN_SEC: 1.2,
  MANNER_JUMP_COUNT: 3,
  MANNER_JUMP_WINDOW_SEC: 5,
  MANNER_NOTICE_SEC: 3.2,
  MANNER_SLOW_SEC: 4,
  MANNER_COOLDOWN_SEC: 8,
  /** 정문을 지날 때 실내·바깥 빛이 바뀌는 시간(눈 적응, 초) */
  AMBIENCE_ADAPT_SEC: 0.9,
  GUIDE_SPEED_SCALE: 1.25,
  GUIDE_ARRIVE_M: 0.12,
  /** 안내 중 이만큼 거의 못 움직이면 안내를 끝낸다(막힌 길) */
  GUIDE_STUCK_SEC: 1.2,
  VIEW_STAND_FORWARD_M: 0.9,
  VIEW_STAND_SIDE_M: 0.55,
  /** 작품 앞에 도착했을 때 화면 채움(정지 지점 0.55보다 크게, "작품을 크게") */
  VIEW_FILL: 0.68,
  /**
   * 따라가는 카메라(3인칭): 캐릭터 머리 쪽 바라보는 높이 비율, 거리 기본·최소·최대(m), 내려다보는 각 기본·최소·최대(rad),
   * 따라가는 부드러움(1/s), 천장 아래 여유. 벽을 넘지 않게 카메라가 걸을 수 있는 곳(+여유) 안에 있도록 당긴다.
   */
  CAM_LOOK_HEIGHT_RATIO: 0.85,
  CAM_DISTANCE_M: { default: 3.4, min: 1.6, max: 7 },
  CAM_PITCH_RAD: { default: 0.3, min: -0.15, max: 1.05 },
  CAM_FOLLOW_DAMP: 7,
  CAM_CEILING_MARGIN_M: 0.35,
  /** 카메라는 걸을 수 있는 곳보다 이만큼 더 벽 쪽까지(캐릭터 반지름만큼 — 벽 면에는 닿지 않음) */
  CAM_WALL_SLACK_M: 0.2,
  /** 가상 조이스틱 반지름(CSS px)·죽은 영역 비율, 이 비율을 넘게 밀면 뛰기 */
  JOYSTICK_RADIUS_PX: 56,
  JOYSTICK_DEAD: 0.12,
  JOYSTICK_RUN: 0.92,
  /** 끌어서 둘러보기(따라가는 카메라 회전, rad/px)·바퀴·두 손가락 벌리기로 거리 바꾸기 */
  ORBIT_RAD_PER_PX: 0.006,
  ZOOM_WHEEL_PER_PX: 0.004,
  /** 멈춘 뒤 이만큼 지나면 다시 그리기를 멈춘다(혼자일 때, PRD 10.1) */
  IDLE_SETTLE_MS: 600,
  TAP_MAX_MS: 300,
  SWIPE_MIN_PX: 50,
  SWIPE_MAX_MS: 600,
  SWIPE_AXIS_RATIO: 1.5,
  SWIPE_MIN_VELOCITY: 0.5,
  PICK_TOLERANCE_PX: 24,
  LOOK_DEG_PER_PX: 0.25,
  WHEEL_DOLLY_MAX_M: 0.6,
  WHEEL_DOLLY_RETURN_SEC: 2,
  FAR_JUMP_FADE_SEC: 0.3,

  // ── 관람 조작 v2 (PRD 19장 G-27, PRD_V2 W-01·W-05·W-06·W-07·W-08) ─
  /**
   * 행동 키(Space·터치 행동 단추, W-01): 도슨트가 `NPC_TALK_RADIUS_M` 안이고 내 앞쪽 `NPC_TALK_ARC_DEG` 안이면 말걸기,
   * 대문이 `GATE_RADIUS_M` 안이면 나가기, 그 밖은 점프. 단추 글·아이콘이 바뀌는 시간은 `ACTION_SWAP_SEC`.
   */
  NPC_TALK_RADIUS_M: 2.5,
  NPC_TALK_ARC_DEG: 120,
  GATE_RADIUS_M: 3,
  ACTION_SWAP_SEC: 0.2,
  /**
   * 내 점프 몸 연출(W-05, 클립 없이 엔진이): 웅크림 → 도약 늘림 → 공중 자세 → 착지 눌림 → 되튐.
   * `*Y`는 키 배율, `*XZ`는 폭 배율. 높이·체공은 `CHAR_JUMP_SPEED_MPS`·`CHAR_GRAVITY_MPS2` 그대로.
   */
  CHAR_JUMP_SQUASH: {
    crouchSec: 0.08,
    crouchY: 0.9,
    crouchXZ: 1.06,
    launchSec: 0.12,
    launchY: 1.08,
    launchXZ: 0.96,
    landSec: 0.1,
    landY: 0.86,
    landXZ: 1.08,
    reboundSec: 0.15,
  },
  /**
   * 공중 자세(뼈 겨누기, 캐릭터 기준 각 rad): 넓적다리는 수직에서 앞으로, 정강이는 뒤로(무릎을 조금 접음), 위팔은 아래에서 옆으로
   */
  CHAR_JUMP_POSE: { thighRad: 0.45, shinRad: 0.35, armOutRad: 1 },
  /**
   * 착지 먼지(인스턴스 판 하나에 조각 `count`개): 퍼지는 반지름(m)·보이는 시간(초)·밝은 흙빛·처음 짙기·
   * 조각 지름 = 반지름 × 비율(`puffFrom` → `puffTo`)·바닥 위로 띄우는 높이(m). 동작 줄이기면 끈다
   */
  JUMP_DUST: {
    count: 6,
    radiusM: 0.45,
    sec: 0.45,
    color: '#e6dac4',
    opacity: 0.55,
    puffFrom: 0.35,
    puffTo: 0.8,
    liftM: 0.02,
  },
  /**
   * 광장 경계(W-06): 경계 `BOUNDARY_SOFT_M` 앞부터 바깥 쪽 입력을 줄이고, 닿으면 `BOUNDARY_PUSH_SEC` 동안 `BOUNDARY_PUSH_M`
   * 부드럽게 안쪽으로 밀어 낸다(벽 부딪힘과 달리 몸 눌림 없음). 같은 알림은 `BOUNDARY_TOAST_SEC`에 한 번.
   */
  BOUNDARY_SOFT_M: 0.6,
  BOUNDARY_PUSH_M: 0.3,
  BOUNDARY_PUSH_SEC: 0.3,
  BOUNDARY_TOAST_SEC: 5,
  /**
   * 사람끼리 부딪힘(W-07): 닿은 채 다가가는 빠르기가 `CROWD_BUMP_MPS` 이상이면 각자 기기에서 `CROWD_BUMP_PUSH_SEC` 동안
   * `CROWD_BUMP_PUSH_M` 밀려나고 알림(같은 알림은 `CROWD_TOAST_SEC`에 한 번). 그보다 느리면 지금처럼 부드럽게 비켜 감.
   */
  CROWD_BUMP_MPS: 0.8,
  CROWD_BUMP_PUSH_M: 0.35,
  CROWD_BUMP_PUSH_SEC: 0.25,
  CROWD_TOAST_SEC: 8,
  /** 사람 부딪힘 몸 연출 세기(벽 부딪힘 = 1) · 상대 빠르기 어림에서 뛰기 빠르기 × 이 배보다 빠르면 같은 사람이 아님 */
  CROWD_BUMP_BODY_GAIN: 0.5,
  CROWD_PEER_MATCH_RUN_RATIO: 1.5,
  /** 멈춰 서 있는데 다른 사람 몸이 겹쳐 올 때 걷기 엔진에 주는 한 프레임 시간 상한(초) */
  CROWD_WAKE_DT_MAX_SEC: 0.1,
  /** 광장 경계에 '닿았다'고 보는 남은 거리(m) — 입력을 비례로 줄이면 끝까지 닿지 않으므로 */
  BOUNDARY_TOUCH_M: 0.05,
  /** 함께 관람 연결이 이만큼(초) 넘게 끊기면 위 줄에 작은 띠 + `재접속하기`(W-08) */
  LIVE_LOST_BANNER_SEC: 6,
  /**
   * 남의 점프(M1b, ADR-073): 서버가 한 연결의 점프를 1초에 이만큼까지 중계(넘는 것은 조용히 버림 — 정상 기기는 착지 전에 다시 못 뛰어
   * 초당 2번을 넘지 않음) · 받는 쪽은 점프 시작 ~ 착지 + `PEER_JUMP_TAINT_MS` 사이 서버 표본을 높이 보간에서 뺀다(공중 y가 섞임) ·
   * 공중에서 둘 뛰기 클립 위상(0..1, 두 넓적다리 사이 각이 가장 큰 곳 — chr-1 GLB 회전 키로 잼, 캐릭터 판이 바뀌면 다시 잰다)
   */
  LIVE_JUMP_MAX_PER_SEC: 2,
  PEER_JUMP_TAINT_MS: 600,
  PEER_JUMP_RUN_PHASE: 0.4,
  /**
   * 도슨트(W-10): `NPC_LOOK_RADIUS_M` 안의 학생 쪽으로 고개·몸을 돌린다(몸은 `NPC_LOOK_MAX_DEG`까지, 돌리는 빠르기 `NPC_TURN_RAD_PER_S`).
   * `NPC_TIP_RADIUS_M` 안에 학생이 있으면 `NPC_TIP_SEC`(무작위 간격) 마다 예절 한마디를 `NPC_TIP_SHOW_SEC` 동안 머리 위에.
   * `말걸기` 대사는 `NPC_TALK_SHOW_SEC` 동안(멀어지거나 걸으면 닫음).
   */
  NPC_LOOK_RADIUS_M: 4,
  NPC_LOOK_MAX_DEG: 60,
  NPC_TURN_RAD_PER_S: 2.5,
  NPC_TIP_RADIUS_M: 10,
  NPC_TIP_SEC: { min: 25, max: 45 },
  NPC_TIP_SHOW_SEC: 4.5,
  NPC_TALK_SHOW_SEC: 6,
  /**
   * 안내판 v4(M3-3, PRD_V2 W-03): 줄 아틀라스 화소·품질별 아틀라스 크기·글 덩이 여백·금속 결·눌린 그늘·띄움·그리는 순서·글 밝기·
   * 포털 레터링 번호 배율·줄 간격·판 치수·판 재질. 글은 가로로 누르거나 자르지 않는다(`fitSign`)
   */
  SIGN_V4: {
    /** 글꼴 크기 1em에 줄 아틀라스 화소 */
    emPx: { title: 72, body: 40 },
    /** 품질 단계별 아틀라스 폭·높이 상한(px). 넘치면 모든 덩이 해상도를 같은 비율로 낮춘다 */
    atlas: {
      width: { HIGH: 2048, MEDIUM: 2048, LOW: 1024 },
      maxHeight: { HIGH: 2048, MEDIUM: 1024, LOW: 1024 },
      gutterPx: 4,
    },
    /** 글 덩이 둘레 여백(글자 크기 배수) — 획이 앞폭 밖으로 나가도 잘리지 않게 */
    inkMargin: 0.14,
    /** 금속 글자 결(위 밝기 → 아래 밝기) · 눌린 그늘(밝기, 오른쪽·아래 어긋남 = 글자 크기 배수) */
    metal: { top: 1, bottom: 0.7 },
    relief: { shade: 0.22, dx: 0.025, dy: 0.045 },
    /** 글을 판·벽 면에서 띄우는 거리(m) · 그리는 순서(불투명 다음, 캐릭터 그늘 2·이름표 10보다 앞) */
    lift: 0.004,
    renderOrder: 1,
    /** 글 색 밝기(톤 매핑 없이 그리는 글자가 어두운 방에서 튀지 않게) */
    letterLight: 0.92,
    /** 포털 레터링: 번호 크기 = 이름 상한 × 이 배(상자 높이 안) · 번호와 이름 사이(번호 크기 배수) */
    numberRatio: 1.9,
    rowGap: 0.32,
    plate: {
      blade: { depth: 0.05, trim: 0.025, rod: 0.035 },
      totem: { plinthH: 0.85, plinthW: 0.56, plinthD: 0.36, cap: 0.025, depth: 0.07, trim: 0.025 },
      banner: { depth: 0.02, rod: 0.05, rodOver: 0.12 },
      rail: { rod: 0.03 },
    },
    /** 판 재질(조명 받음) */
    plateFinish: { roughness: 0.62, metalness: 0.12 },
  },
  /** 안내판 종류별 모양(판 종류·양면·여백·맞춤·키우는 쪽·글 덩이별 글꼴 크기 상한·하한·줄 수·줄 높이·색 결) */
  SIGN_V4_KINDS: {
    // ① 외관 프리즈: 엔타블러처 띠에 청동 글자
    frieze: {
      plate: 'none',
      doubleSided: false,
      pad: 0,
      align: 'center',
      valign: 'middle',
      growY: 'center',
      growX: 'center',
      arrange: 'stack',
      headShare: 1,
      gap: 0,
      title: { face: 'title', max: 0.62, min: 0.22, maxLines: 2, lineHeight: 1.15, tone: 'bronze' },
    },
    // ② 현수막: 숯색 천 + 놋쇠 봉, 상아 글자(위쪽부터)
    banner: {
      plate: 'banner',
      doubleSided: false,
      pad: 0.26,
      align: 'center',
      valign: 'top',
      growY: 'top',
      growX: 'center',
      arrange: 'stack',
      headShare: 1,
      gap: 0,
      title: { face: 'title', max: 0.4, min: 0.22, maxLines: 6, lineHeight: 1.2, tone: 'ivory' },
    },
    // ③ 포털 위 레터링: 큰 번호 + 전시실 이름, 놋쇠 글자, 판 없음
    portalLettering: {
      plate: 'none',
      doubleSided: false,
      pad: 0,
      align: 'center',
      valign: 'middle',
      growY: 'center',
      growX: 'center',
      arrange: 'row',
      headShare: 1,
      gap: 0,
      number: { face: 'title', max: 0.8, min: 0.22, maxLines: 1, lineHeight: 1, tone: 'brass' },
      title: { face: 'title', max: 0.42, min: 0.22, maxLines: 2, lineHeight: 1.15, tone: 'brass' },
    },
    // ④ 돌출 사인: 숯색 판 + 놋쇠 테·봉, 양면. 번호(놋쇠) + 이름(상아). 넘치면 벽에서 먼 쪽·아래로 키운다
    blade: {
      plate: 'blade',
      doubleSided: true,
      pad: 0.08,
      align: 'center',
      valign: 'middle',
      growY: 'top',
      growX: 'wall',
      arrange: 'stack',
      headShare: 0.42,
      gap: 0.03,
      number: { face: 'title', max: 0.26, min: 0.16, maxLines: 1, lineHeight: 1.1, tone: 'brass' },
      title: { face: 'title', max: 0.16, min: 0.12, maxLines: 3, lineHeight: 1.2, tone: 'ivory' },
    },
    // ⑤ 안내 토템: 받침대 + 판. 제목(놋쇠) + 방 목록(상아). 넘치면 판이 위로 자란다
    totem: {
      plate: 'totem',
      doubleSided: false,
      pad: 0.08,
      align: 'left',
      valign: 'top',
      growY: 'bottom',
      growX: 'center',
      arrange: 'stack',
      headShare: 0.22,
      gap: 0.06,
      title: { face: 'title', max: 0.11, min: 0.07, maxLines: 2, lineHeight: 1.2, tone: 'brass' },
      body: { face: 'body', max: 0.075, min: 0.045, maxLines: 24, lineHeight: 1.45, tone: 'ivory' },
    },
    // ⑥ 전시실 소개 벽: 벽에 바로 놓인 상아 글자. 제목(크게) + 소개 글, 위에서부터 왼쪽 맞춤
    introWall: {
      plate: 'none',
      doubleSided: false,
      pad: 0,
      align: 'left',
      valign: 'top',
      growY: 'top',
      growX: 'center',
      arrange: 'stack',
      headShare: 0.36,
      gap: 0.14,
      title: { face: 'title', max: 0.3, min: 0.16, maxLines: 2, lineHeight: 1.18, tone: 'ivory' },
      body: { face: 'body', max: 0.075, min: 0.045, maxLines: 14, lineHeight: 1.6, tone: 'ivory' },
    },
    // ⑦ 출구: 놋쇠 글자(벽 없는 대문 자리는 가는 놋쇠 봉 둘 사이)
    exit: {
      plate: 'none',
      doubleSided: false,
      pad: 0,
      align: 'center',
      valign: 'middle',
      growY: 'center',
      growX: 'center',
      arrange: 'stack',
      headShare: 1,
      gap: 0,
      title: { face: 'title', max: 0.5, min: 0.22, maxLines: 2, lineHeight: 1.1, tone: 'brass' },
    },
  },
  /**
   * 도슨트 움직임(M4-7): 몸을 `NPC_LOOK_MAX_DEG`까지 돌린 뒤 고개가 더 도는 한계(도) · 고개가 몸보다 빨리 도는 배수 ·
   * 고개 돌림의 목 몫(목 + 머리 = 1) · 말할 때 끄덕임(횟수·Hz·rad) · 안내 손짓 자세(캐릭터 기준 바깥 x·위 y·앞 z) ·
   * 한 프레임 시간 상한(s) · 다 돈 것으로 보는 남은 각(rad) · 머리 위 말풍선 높이(m)·자리 갱신 문턱(px) · 발밑 그늘 띄움(m) ·
   * 임시 모형 숨쉬기(세로 늘림·길이 s)
   */
  NPC_MOTION: {
    headMaxDeg: 45,
    headTurnGain: 1.8,
    neckShare: 0.4,
    nod: { count: 2, hz: 1.6, rad: 0.14 },
    guide: { upper: [0.55, -0.45, 0.7], fore: [0.35, 0.1, 0.93] },
    dtMaxSec: 0.1,
    settleRad: 0.005,
    bubbleAboveM: 0.25,
    bubbleMovePx: 0.5,
    shadowLiftM: 0.012,
    breath: { amp: 0.012, sec: 3.6 },
  },
  /**
   * 공간 v4(ADR-071, PRD_V2 §5): `algoVersion ≥ 4`일 때만 쓰는 치수. v3 배치·해시는 이 값을 읽지 않는다.
   * 모든 길이는 m. 조각 단위(2m) 배수여야 하는 값: 홀 폭·방 폭(4m 배수 — 가운데 포털 4m 양옆이 2m 배수)·방 깊이·방 사이 틈.
   */
  /**
   * 전시실 벽 와시(PRD_V2 W-12 ①, M3-4 — 색·세기·높이는 `look.wash`): 코브 아래 띄움(m) · 벽에서 띄움(m) · 문 열림 양옆
   * 더 비우는 폭(m) · 문 위 벽 띠가 문틀에서 떨어지는 높이(m) · 문을 벽 위의 것으로 보는 거리(m) · 세로 칸 수 · 밝기 곡선 지수
   */
  WALL_WASH: {
    topGapM: 0.3,
    liftM: 0.02,
    doorTrimM: 0.3,
    doorTopGapM: 0.15,
    doorSnapM: 0.6,
    rows: 5,
    falloff: 1.6,
  },
  LAYOUT_V4: {
    /** 관 하나의 작품 상한(v3 `ROOM_SPLIT_AT` 대신) · 작품 수 ≤ sMax → S, ≤ mMax → M, 그 위 L */
    splitAt: 8,
    sizeSMax: 3,
    sizeMMax: 6,
    /** 관 최소 크기: 폭 W(홀을 따라) × 깊이 D(홀에서 멀어지는 쪽) */
    room: { S: { w: 12, d: 10 }, M: { w: 16, d: 12 }, L: { w: 20, d: 14 } },
    roomMaxW: 28,
    roomMaxD: 20,
    roomHeight: 6,
    /** 이젤 수(가운데 섬): 큰 방에만 하나 */
    easels: { S: 0, M: 0, L: 1 },
    /** 같은 날개 이웃 관 사이(두꺼운 벽 — 방 사이 문이 이 깊이의 통로) */
    roomGap: 2,
    /** 액자 사이 최소 여백 · 모서리 여백 · 문 옆 여백 */
    frameGapMin: 2,
    cornerMargin: 1.2,
    doorMargin: 0.8,
    /** 홀 쪽 포털(조각 폭 · 맑은 폭 · 높이) */
    portal: { w: 4, clear: 3.6, h: 4.2 },
    /** 방 사이 문(L·R 벽, N 끝에서 `fromN`부터 조각 폭 `w`) */
    enfilade: { w: 4, clear: 2.4, h: 3.6, fromN: 2 },
    /** 메인홀: 폭 · 천장 · 최소 길이 · 정문 벽에서 첫 관까지 · 날개 끝에서 홀 끝 벽까지 · 정문 조각 폭 */
    hall: { w: 20, h: 10, minLength: 30, front: 4, back: 8, entrance: 4 },
    /** 안내판(W-03): 제목 아래 끝 높이 하한 · 앞에 사람이 설 자리를 두지 않는 거리 */
    signTitleMinY: 2.6,
    signClear: 2.5,
    /** 포털 위 레터링 높이(바닥에서 글자 한가운데) · 돌출 사인 높이 · 소개 벽 글판 크기 */
    portalLetteringY: 5,
    bladeY: 3.2,
    introWall: { w: 3.2, h: 2.4, y: 2.2 },
    /** 대문(광장 앞 끝 가운데, 폭 = 산울타리 트인 곳) · 광장 앞 끝에서 안쪽 · 대문에서 처음 서는 자리까지 */
    gate: { w: 4, insetM: 0, spawnInsideM: 4.5 },
    /** 도슨트 자리: 벽 앞 거리, 광장 도슨트의 축 길에서 옆으로 */
    npcWallM: 0.6,
    npcPlazaSideM: 3.5,
    /** 장식 바닥 넓이(걷기에서 피함, 가로 × 깊이) */
    decorFootprint: {
      fountain: { w: 5, d: 5 },
      sculpture: { w: 1.2, d: 1.2 },
      bust: { w: 0.6, d: 0.6 },
      planter: { w: 0.9, d: 0.9 },
      topiary: { w: 1, d: 1 },
      urn: { w: 0.7, d: 0.7 },
      bench: { w: 1.8, d: 0.6 },
      desk: { w: 2.4, d: 0.9 },
    },
    /** 홀 축 위 섬(장식) 간격, 홀 벽기둥(베이) 간격 */
    hallIslandSpacing: 12,
    bay: 4,
  },

  // ── 품질·메모리 (PRD 10장, ADR-015·035) ─────────────────────
  DPR_CAP_DESKTOP: 2,
  DPR_CAP_TABLET: 1.5,
  DPR_CAP_PHONE: 1.25,
  MSAA_MAX_DPR: 1.5,
  TEX_BUDGET_MB_HIGH: 140,
  TEX_BUDGET_MB_MEDIUM: 90,
  TEX_BUDGET_MB_LOW: 30,
  /** 상주 관리(§6.5): 가장 가까운 작품의 걷는 순서 뒤·앞 창(벽용), 벽용을 쓰려면 필요한 최대 텍스처 크기 */
  RESIDENCY_WINDOW: {
    HIGH: { behind: 3, ahead: 6 },
    MEDIUM: { behind: 2, ahead: 3 },
    LOW: { behind: 1, ahead: 2 },
  },
  RESIDENCY_MIN_TEXTURE_FOR_WALL: 2048,
  /** 받지 못한 작품 그림 다시 받기(§6.5): 실패 뒤 `delayMs`가 지나 다음 원하는 집합을 정할 때, 그림마다 `max`번까지(배로 늘림) */
  RESIDENCY_RETRY: { max: 3, delayMs: 5000 },
  /** 그리는 관(§6.6, 자유 관람): 캐릭터에서 관 바닥까지 이 거리 안이면 붙인다 */
  VISIBLE_PART_RADIUS_M: { HIGH: 14, MEDIUM: 10, LOW: 6 },
  /** 품질 단계 내리기(§6.10): 움직이는 구간 중앙 fps 기준·판정에 필요한 최소 프레임 수 */
  QUALITY_FPS_FLOOR: { desktop: 50, tablet: 40, phone: 28 },
  QUALITY_MIN_SEGMENT_FRAMES: 30,
  /** 지금 정지 지점 앞뒤로 벽용 텍스처를 올리는 창 */
  WALL_WINDOW: {
    HIGH: { back: 3, ahead: 6 },
    MEDIUM: { back: 2, ahead: 3 },
    LOW: { back: 1, ahead: 2 },
  },
  FPS_DOWN_DESKTOP: 50,
  FPS_DOWN_TABLET: 40,
  FPS_DOWN_PHONE: 28,
  FALLBACK_2D_FPS: 20,
  /** 2D 대체 화면으로(ADR-019, §6.12): '낮음'에서 이만큼 연속 구간이 `FALLBACK_2D_FPS` 미만 · 이 시간 안 컨텍스트 손실 횟수 */
  FALLBACK_2D_LOW_SEGMENTS: 3,
  FALLBACK_2D_CONTEXT_LOSSES: { count: 2, windowSec: 60 },
  /**
   * 입장 준비 시간 상한(G-24, FIELD_PLAN HW-01): 조각 glb 하나가 이 시간 동안 받는 진행이 없으면 그 파일은 못 받은 것으로 친다 ·
   * 포스터가 뜬 뒤 이 시간 안에 3D 첫 자리가 준비되지 않으면 `입장하기`를 풀고, 누르면 가벼운 화면(2D)으로 들어간다.
   * 한 반이 학교 와이파이 하나를 함께 쓰면 3D 파일을 다 받는 데 수십 초가 걸릴 수 있어 3D는 그 뒤에도 계속 받는다
   * (누르기 전에 준비되면 그대로 3D로).
   */
  MODULE_LOAD_STALL_MS: 15_000,
  VISIT_READY_TIMEOUT_MS: 20_000,
  /**
   * 기기 보고(G-24·G-25, FIELD_PLAN HW-02·HR): 익명 진단·실기기 반응성 보고(ADR-070). 관람을 이만큼 하면 한 번 보내고
   * (그 전에 화면이 숨으면 그때) · 보고 글 크기 상한 · 서버가 날마다 남기는 보고 파일을 지키는 날 수 ·
   * 교사 화면에 보이는 "가벼운 화면으로 들어온 수"를 모으는 시간.
   */
  DEVICE_REPORT_AFTER_SEC: 60,
  DEVICE_REPORT_MAX_BYTES: 2048,
  DEVICE_REPORT_KEEP_DAYS: 14,
  DIAG_COUNT_WINDOW_MIN: 180,
  /**
   * 학교망 점검 `/check`(G-24 HW-00): 서버 응답·함께 관람 연결 상한(ms) · 됐어도 이보다 오래면 느림(ms) · 받는 빠르기가 이보다
   * 낮으면 느림(Mbps — 한 반 30명이 한 와이파이로 한 명당 약 5MB를 함께 받으면 `VISIT_READY_TIMEOUT_MS` 안에 못 받는 학생이
   * 생기기 쉬운 선). 파일 단계 상한은 `MODULE_LOAD_STALL_MS`를 쓴다
   */
  CHECK_SERVER_TIMEOUT_MS: 8000,
  CHECK_LIVE_TIMEOUT_MS: 8000,
  CHECK_SLOW_LATENCY_MS: 1500,
  CHECK_SLOW_MBPS: 20,
  /** 누름 → 다음 그림까지를 잴 때 한 번에 기다리는 상한(넘으면 그 누름은 세지 않음 — 화면이 숨은 경우 등) */
  INPUT_LATENCY_MAX_MS: 2000,
  FOG_START_M: 18,
  FOG_END_M: 25,

  /** 서비스 워커(P4-8, PLAN §9.6): `GET /api/e/{code}` 네트워크 우선 대기 · 등록·제어 대기 · 파일별 메시지 대기 · 템플릿 공간 미리 셈(§2.5 2.5MB) */
  SW_API_TIMEOUT_MS: 3000,
  SW_READY_TIMEOUT_MS: 5000,
  SW_MESSAGE_TIMEOUT_MS: 30_000,
  SW_TEMPLATE_RESERVE_BYTES: 2_500_000,

  // ── 소리 (G-06, ADR-011·046) ───────────────────────────────
  BGM_CROSSFADE_SEC: 1.5,
  BGM_DUCK_LEVEL: 0.2,
  BGM_DUCK_IN_SEC: 0.3,
  BGM_DUCK_OUT_SEC: 0.6,
  AMBIENT_SOUND_DEFAULT: false,
  AUDIO_SILENCE_DBFS: -45,
  AUDIO_TARGET_LOUDNESS_DB: -16,
  AUDIO_GAIN_LIMIT_DB: 6,
  AUDIO_ANALYSIS_WINDOW_MS: 50,
  AUDIO_ANALYSIS_SAMPLE_RATE: 22050,
  /** 소리 크기 평균에서 빼는 아주 작은 구간(무음 조각이 평균을 끌어내리지 않게) */
  AUDIO_LOUDNESS_GATE_DBFS: -50,
  AUDIO_AAC_KBPS: 160,

  // ── 자동 투어 (G-16, ADR-046) ──────────────────────────────
  TOUR_TIME_MODE_DEFAULT: 'MUSIC' as 'MUSIC' | 'FIXED',
  TOUR_MUSIC_MAX_SEC: 360,
  TOUR_MIN_SEC_PER_ARTWORK: 5,
  TOUR_FADE_IN_SEC: 2.5,
  TOUR_FADE_OUT_SEC: 4,
  TOUR_SONG_OVERLAP_SEC: 1,
  TOUR_VISUAL_DIP: 0.15,
  TOUR_LINGER_PUSH: 0.03,
  TOUR_LINGER_CLOSEUP_AFTER_SEC: 30,
  TOUR_PAUSE_FADE_SEC: 0.4,
  TOUR_RESUME_FADE_SEC: 0.6,
  TOUR_SKIP_FADE_SEC: 1.2,
  TOUR_END_FADE_SEC: 1.5,
  TOUR_HALL_SEC: 5,
  TOUR_NAMEPLATE_SEC: 4,
  TOUR_TRANSITION_SEC: 2,
  TOUR_EXIT_SEC: 5,
  TOUR_MIN_SECONDS_PER_PART: 20,
  /** 작품 구간의 다가가기 시간(나머지는 머무르기, §6.13) */
  TOUR_APPROACH_SEC: 2.5,
  /** 한 작품에 오래 머무를 때 한 번 다가가는 배율 */
  TOUR_LINGER_CLOSEUP_SCALE: 1.2,
  /** 작품 정지 지점들을 잇는 투어 경로의 거리 배율(물러서서 지나감) */
  TOUR_PATH_DISTANCE_SCALE: 1.25,
  /** 입구 홀: 검은 화면에서 페이드인 */
  TOUR_HALL_FADE_IN_SEC: 2,
  /** 출구: 마지막 곡과 함께 페이드아웃 */
  TOUR_EXIT_FADE_OUT_SEC: 3,
  /** 투어 걸음 속도 상한(m/s): 관 사이 경로가 길면 마지막 작품에서 그만큼 일찍 떠난다 */
  TOUR_WALK_SPEED_MPS: 6,
  /** 이전 곡이 이 비율 아래로 줄어든 때 다음 곡을 시작 */
  TOUR_NEXT_SONG_AT_LEVEL: 0.3,
  TOUR_PRELOAD_AHEAD: 8,

  // ── 서버 (PLAN §9) ─────────────────────────────────────────
  /** 사용자 IP를 믿는 머리 하나(§11.3): CloudFront 공용 입구 함수 = x-gw-viewer-ip, Cloudflare 직접 = cf-connecting-ip */
  CLIENT_IP_HEADER: 'x-gw-viewer-ip' as 'x-gw-viewer-ip' | 'cf-connecting-ip',
  // ── 서버 실행 (PLAN §9.1·§9.3·§9.8·§11.4) ───────────────────
  JSON_BODY_MAX_KB: 64,
  /** 기기 → 서버 요청이 답 없이 기다리는 상한(웹 어댑터 P4-1a) */
  API_TIMEOUT_MS: 15000,
  /**
   * 함께 관람(ADR-057, `types/live.ts`): 기기 위치 보내기·서버 방송 횟수, 전시 하나에 이을 수 있는 사람,
   * 메시지 크기, `hello`를 기다리는 시간, 위치가 오지 않으면 끊는 시간, 살아 있는지 묻는 간격, 다시 잇기 간격(지수 증가),
   * IP 하나가 1분에 열 수 있는 연결 수.
   */
  LIVE_POSE_HZ: 5,
  LIVE_BROADCAST_HZ: 5,
  LIVE_MAX_PER_EXHIBITION: 80,
  LIVE_MAX_MESSAGE_BYTES: 1024,
  LIVE_HELLO_TIMEOUT_MS: 5000,
  LIVE_IDLE_TIMEOUT_SEC: 90,
  /** 위치가 그대로여도 이 간격으로 한 번 다시 보낸다(가만히 오래 보는 사람이 끊기지 않게, 쉬는 시간 상한보다 짧게) */
  LIVE_KEEPALIVE_SEC: 30,
  LIVE_PING_SEC: 20,
  LIVE_RETRY_MIN_MS: 1000,
  LIVE_RETRY_MAX_MS: 30000,
  /**
   * 교실 기기 30여 대가 공인 IP 하나를 함께 쓰고 다시 잇기까지 겹치므로 넉넉히(PLAN §11.3 "IP 칸은 기기 칸보다 높게").
   * 학교 전체(여러 반)가 한 IP라 120에서 600으로 올림(G-24, ADR-070)
   */
  LIVE_CONNECT_PER_IP_MIN: 600,
  /** 다른 관람객을 온몸으로 그리는 수(가까운 순) · 이 거리 밖은 낮은 단계 · 그 밖은 이름표만 */
  LIVE_VISIBLE_MAX: { phone: 6, tablet: 12, desktop: 24 },
  /**
   * 다른 관람객 이름표(말풍선 규칙과 같게, PRD_V2 W-02): 이보다 멀면 숨김(m) · 겹치면 위로 올리는 한 칸(m)·최대 칸 수 —
   * 그래도 겹치면 숨긴다(30명 회랑에서 이름표가 서로 덮이던 것, 2026-11-14 e2e)
   */
  PEER_TAG: { maxDistM: 12, stackStepM: 0.22, stackMax: 2 },
  LIVE_LOD_NEAR_M: 15,
  /** 받은 위치를 이만큼 늦춰 두 방송 사이를 보간(방송 간격의 2배) */
  LIVE_INTERP_DELAY_MS: 400,
  /** 내가 멈춰 있고 다른 사람만 움직일 때 기기가 다시 그리는 상한(초당, G-25 HS-06). 내가 걸으면 상한 없음 */
  LIVE_PEER_REDRAW_FPS: 20,
  /** 서버 1분 기록의 이벤트 루프 지연 재기 단위(ms, `perf_hooks.monitorEventLoopDelay`, G-25 HS-00) */
  STATS_LOOP_RESOLUTION_MS: 20,
  /**
   * 함께 관람 서버 효율(G-25 HS-03~HS-05·HS-10, ADR-072, 판 2 기기에만):
   * - 관심 영역: 이 크기(m)의 바닥 칸으로 사람을 묶어, 자기 칸과 둘레 8칸 사람은 매 차례, 그 밖은 `LIVE_FAR_EVERY` 차례마다(=1초에 한 번).
   * - 느린 기기: 보낼 줄이 이 바이트를 넘으면 그 차례 위치는 건너뛰고(다음에 모두의 지금 자리를 한 번에), 이 시간(초) 동안 계속 밀리면
   *   1013으로 닫는다(기기는 다시 잇는다).
   * - 넘칠 때: 서버 전체 연결 상한(교사 제외), 1분 이벤트 루프 지연 p99가 이 ms를 넘으면 한 사람 위치를 `LIVE_DEGRADE_EVERY` 차례에
   *   한 번으로 줄인다(초당 5 → 2.5번). 다음 1분이 괜찮으면 되돌린다.
   */
  LIVE_AOI_CELL_M: 15,
  LIVE_FAR_EVERY: 5,
  LIVE_SEND_BUFFER_MAX_BYTES: 32_768,
  LIVE_SLOW_CLOSE_SEC: 15,
  LIVE_MAX_TOTAL: 200,
  LIVE_DEGRADE_LOOP_MS: 80,
  LIVE_DEGRADE_EVERY: 2,
  SHUTDOWN_WAIT_SEC: 20,
  LOG_KEEP_FILES: 7,
  DB_BUSY_TIMEOUT_MS: 5000,
  /** HSTS 기간(§11.4 — 쌤유니버스 상위 도메인이 includeSubDomains라 하위 도메인도 HTTPS) */
  HSTS_MAX_AGE_SEC: 31_536_000,
  UPLOAD_SLOTS_PER_EXHIBITION: 3,
  UPLOAD_SLOTS_GLOBAL: 6,
  UPLOAD_RESERVE_FACTOR: 3,
  UPLOAD_IDLE_TIMEOUT_SEC: 120,
  /**
   * 업로드 횟수 칸(§11.3): 기기·IP마다 `windowSec` 안에 올리기 요청 수. 선생님이 폴더째(학급 작품 수십~수백 개)
   * 올려도 막히지 않게 기기 초당 1개 꼴, 학교 공용 IP는 여러 선생님을 생각해 더 높게. 동시 수신·공간은 위 칸이 따로 막는다.
   */
  UPLOAD_RATE: { device: 600, ip: 2000, windowSec: 600 },
  SHARP_THREADS: 2,
  SHARP_LIMIT_INPUT_PIXELS: 120_000_000,
  TOOL_TIMEOUT_MS: 20_000,
  PDF_INCOMPLETE_PURGE_HOURS: 2,
  DELETE_WAIT_SEC: 30,
  MEDIA_STATE_CACHE_SEC: 10,
  PROCESS_CONCURRENCY: 1,
  PROCESS_QUEUE_MAX: 30,
  EXHIBITION_MAX_MB: 800,
  MEDIA_DISK_MAX_GB: 40,
  DISK_FREE_MIN_GB: 10,
  MEDIA_BROWSER_MAX_AGE_SEC: 2_592_000,
  MEDIA_CDN_MAX_AGE_SEC: 86_400,
  /** 맥미니가 멈췄을 때 CDN이 이미 가진 미디어 사본을 계속 내주는 상한(§9.6 stale-if-error, ADR-049) */
  MEDIA_STALE_IF_ERROR_SEC: 86_400,
  /**
   * 해시 이름 앱 파일 `/assets/g/*`(§9.6 표, ADR-028): 내용이 바뀌면 이름이 바뀌므로 1년 + `immutable`.
   * 맥미니가 멈췄을 때 CDN이 이미 가진 앱 껍데기를 계속 내주는 상한은 7일(`stale-if-error`, ADR-049).
   */
  STATIC_ASSET_MAX_AGE_SEC: 31_536_000,
  STATIC_STALE_IF_ERROR_SEC: 604_800,
  RETENTION_JOB_SEC: 60,
  PURGE_JOB_SEC: 3600,
  LAYOUT_KEEP_VERSIONS: 2,

  // ── 교사 작업 화면 v3 축측 지도 (FIELD_PLAN §5.4 ③·HT-04, `apps/web/src/viewer/map/axo.ts`) ──
  /**
   * 투영: 방위 `azimuthDeg`(복도 z가 거의 가로로 눕게)·고도 `elevationDeg`의 정사영. 길이는 m, 화면 값은 px.
   * 벽은 낮게 자른 두께 `wallThickM`·높이 `wallHeightM`. 문은 벽 방향이 같고(`doorAlignTol`) 벽선에서 `doorSnapM` 안인
   * 문 폭만큼 벽을 끊는다. `minPieceM`보다 짧은 조각은 버린다. `dedupeM` 안에서 겹치는 벽(이웃 관이 같은 벽을 낼 때)은 한 번만.
   */
  AXO: {
    azimuthDeg: 20,
    elevationDeg: 35,
    wallThickM: 0.3,
    wallHeightM: 1.15,
    doorAlignTol: 0.01,
    /** 세운 면이 보는 쪽을 향하는지 가르는 문턱 */
    faceTol: 0.01,
    doorSnapM: 0.35,
    minPieceM: 0.05,
    dedupeM: 0.01,
    /** 문 자리 바닥판: 벽 두께 양쪽으로 이만큼 */
    doorFloorM: 0.32,
    /** 작품 자리 막대: 벽에서 `frameSnapM` 안인 벽에 붙임, 폭 = 액자 폭 × `frameWidthRatio`, 두께 2×`frameHalfDepthM` */
    frameSnapM: 0.2,
    frameWidthRatio: 0.92,
    frameHalfDepthM: 0.1,
    frameInsetM: 0.06,
    frameLiftM: 0.02,
    easelHalfWidthM: 0.36,
    easelHeightM: 0.95,
    /** 이젤 윗변 폭 / 아랫변 폭 */
    easelTopRatio: 0.8,
    /** 입구 화살표(정면 `facadeZ` 기준 안쪽 끝·바깥 꼬리·반폭·오목)와 글자 자리 */
    entryTipInM: 1.3,
    entryTailOutM: 0.4,
    entryHalfWidthM: 0.9,
    entryNotchM: 0.6,
    entryLabelOutM: 3.6,
    /** 고른 작품 핀: 벽에서 앞으로 `pinOffsetM`, 바닥 고리 반지름, 세운 높이(m), 머리 반지름(px), 위 여백(px) */
    pinOffsetM: 1.4,
    pinRingM: 1.1,
    pinRingSegments: 28,
    pinHeightM: 4.6,
    pinHeadPx: 7,
    pinTopPx: 26,
    padPx: 12,
    /** 전시실 번호: 글자 크기 = max(`labelMinPx`, 축척 × `labelPerM`). 이젤이 있는 방은 번호를 −z로 `labelShiftM` 옮김 */
    labelMinPx: 12,
    labelPerM: 2.1,
    labelShiftM: 3,
    /** 수업 지도에서 번호 옆 학생 수 글자의 간격(번호 글자 크기 배) */
    countGapRatio: 0.33,
    /** 학생 점: 반지름 = max(`dotMinPx`, 축척 × `dotPerM`). 벽에서 `dotMarginM` 안쪽에, 점끼리 `dotGapM`(시도가 늘면 차례로 풂) */
    dotMinPx: 3.2,
    dotPerM: 0.36,
    dotMarginM: 1.7,
    dotGapM: [1.5, 1.1, 0.8],
    dotRelaxEvery: 1500,
    dotMaxTries: 6000,
    /** 번호 둘레 비우기: 반폭 = 글자 × `labelHalfW`, 반높이 = 글자 × `labelHalfH`, 여유 px */
    labelHalfW: 0.6,
    labelHalfH: 0.55,
    labelClearPx: 4,
  },
  /**
   * 교사 작업 화면 v3 끌어 놓기(FIELD_PLAN §5.5): 액자 비율이 이 범위 밖이면 형태 갈래 비율로 · 키보드로 옮길 때 놓는 자리
   * (액자 폭의 앞·뒤 이만큼) · 보드 위·아래 끝에서 저절로 스크롤되는 문턱(화면 높이 비율) · 끄는 액자 확대 ·
   * 휴대폰 접힌 판 머리 위에 머물면 펼쳐지기까지
   */
  MANAGE_FRAME_RATIO_MIN: 0.45,
  MANAGE_FRAME_RATIO_MAX: 2.4,
  MANAGE_KEYBOARD_EDGE: 0.25,
  MANAGE_AUTOSCROLL_THRESHOLD: 0.15,
  MANAGE_DRAG_SCALE: 1.06,
  MANAGE_DROP_EXPAND_MS: 600,
} as const;

/** 숫자·참거짓은 넓은 타입으로(기본값의 리터럴 타입에 묶이면 시험·환경 변수로 값을 바꿀 수 없다). 문자열 합집합은 그대로. */
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T;
export type Config = { readonly [K in keyof typeof configDefaults]: Widen<(typeof configDefaults)[K]> };
export type ConfigKey = keyof Config;

/** 지금 쓰는 설정. 시험과 서버 환경 변수만 `overrideConfig`로 바꾼다. */
let current: Config = configDefaults;

export const config = (): Config => current;

/** 시험·서버 시작 때만 부른다. 바꾼 값은 다음 `config()` 호출부터 보인다. */
export const overrideConfig = (patch: Partial<{ -readonly [K in ConfigKey]: Config[K] }>): void => {
  current = { ...current, ...patch } as Config;
};

export const resetConfig = (): void => {
  current = configDefaults;
};
