import type { ErrorCode } from '../errors.ts';

/**
 * 화면 문구 한 곳(AGENTS.md §3). 화면 파일은 한국어를 직접 쓰지 않고 여기서 가져온다.
 * 학생 문구에는 기술 용어(서버, 동기화, 브라우저, 업로드, 오류 코드, 에러)를 쓰지 않는다.
 * PRD에 있는 문구는 PRD 그대로, 없는 문구는 PLAN §7·§17.2를 따른다. 초5 눈높이 검토는 P6-7(Antigravity).
 */

/** 오류 코드별 문구(PLAN §17.2). `{n}` 같은 자리는 `fill()`로 채운다. */
export const errorCopy: Record<ErrorCode, string> = {
  E_NOT_FOUND: '이 전시는 막을 내렸어요',
  E_EXHIBITION_CLOSED: '이 전시는 막을 내렸어요',
  E_EXHIBITION_DRAFT: '아직 준비 중인 전시예요',
  E_REACTIONS_OFF: '지금은 반응을 받지 않아요',
  E_MEMO_BLOCKED: '다른 말로 적어 볼까요?',
  E_PIN_TAKEN: '이미 쓰이는 PIN이에요',
  E_PIN_WEAK: '쉬운 번호예요. 다른 번호로 정해 주세요',
  E_PIN_INVALID: 'PIN이 맞지 않아요',
  E_PIN_LOCKED: '잠시 뒤에 다시 해 주세요 ({n}분)',
  E_START_CODE: '시작 코드가 맞지 않아요',
  E_AUTH: '다시 들어와 주세요',
  E_RATE_LIMITED: '잠깐 쉬었다가 다시 해 주세요',
  E_VALIDATION: '입력한 내용을 다시 확인해 주세요',
  E_CONFLICT: '다른 곳에서 바뀌었어요. 새로 불러올게요',
  E_NOTHING_PUBLISHED: '게시한 작품이 있어야 열 수 있어요',
  E_FILE_TYPE: '이 파일은 전시할 수 없어요',
  E_VIDEO_UNSUPPORTED: '아직 영상은 전시할 수 없어요',
  E_FILE_TOO_SMALL: '그림이 너무 작아요. 1080px 이상으로 다시 내려받아 주세요',
  E_FILE_TOO_LARGE: '파일이 너무 커요',
  E_ASPECT: '너무 길어서 전시하기 어려워요. 나눠서 올려 주세요',
  E_PDF_PAGES: '30쪽 이하로 나눠 주세요',
  E_TEXT_LENGTH: '글이 너무 길어요',
  E_AUDIO_LENGTH: '10분 이하로 올려 주세요',
  E_FILE_BROKEN: '파일을 열 수 없어요',
  E_HEIC_UNSUPPORTED: 'JPG로 다시 올려 주세요',
  E_DUPLICATE: '이미 올린 작품이에요',
  E_QUOTA: '전시에 담을 수 있는 양을 넘었어요',
  E_BUSY: '작품을 다듬는 중이에요. 잠시 뒤 이어서 올릴게요',
  E_LIVE_FULL: '지금은 친구들이 너무 많아서 혼자 둘러봐요',
  E_OFFLINE: '잠깐 연결이 끊겼어요',
  E_SERVER: '잠시 문제가 생겼어요',
};

/** 화면별 문구. 키는 화면·요소 순서로 이름 짓는다. */
export const copy = {
  poster: {
    enter: '입장하기',
    preparing: '준비하고 있어요',
    openUntil: '{date}까지 열려요',
    inAppBrowserHint: '소리가 안 나면 Safari나 Chrome으로 열어 주세요',
    /** 입장·캐릭터 고르기(ADR-057, R-7 제안) */
    enterPlaza: '전시관 광장으로 입장하기',
    nicknameLabel: '내 별명',
    nicknameHint: '캐릭터 머리 위 이름표와 감상 메모에 보여요',
    nicknamePlaceholder: '전시관에서 부를 별명을 적어 주세요',
    characterLabel: '내 캐릭터 고르기',
    characterHint: '전시관을 걸어 다닐 모습을 골라요',
    studentMale: '학생 A',
    studentFemale: '학생 B',
    togetherNotice: '같은 전시관에 들어온 친구들과 별명을 보며 함께 걸어요',
    togetherCount: '친구 {n}명 관람 중',
  },
  viewer: {
    collection: '모아 보기',
    map: '전시실 지도',
    sound: '소리',
    intro: '소개',
    /** 위치 표시(PLAN §4.7): 전시실 소개 · 작품 정지 지점 · 나뉜 관 이름 */
    stopIntro: '{room} · 소개',
    stopArtwork: '{room} · {index}/{count}',
    partName: '{room} · {part}관',
    prev: '이전',
    next: '다음',
    close: '닫기',
    more: '더 보기',
    react: '반응 남기기',
    pageOf: '{page}/{total}',
    rotateHint: '가로로 돌리면 더 크게 보여요',
    continueReading: '이어서 보기',
    updated: '전시가 새로 바뀌었어요',
    updatedAction: '새로 보기',
    waitAMoment: '잠시만 기다려 주세요',
    exitThanks: '관람해 주셔서 고마워요',
    exitCount: '작품 {n}점',
    restart: '처음부터 다시 보기',
    /** 미술관 정면 이름판(ADR-057): 전시명이 이미 '전시관·미술관·박물관·전시회'로 끝나면 전시명 그대로 */
    facadeSign: '{title} 전시관',
    /** 전시명이 이 말로 끝나면 이름판에 전시명 그대로 */
    facadeSuffixes: ['전시관', '미술관', '박물관', '전시회', '갤러리'] as readonly string[],
    stopExterior: '{title} 앞',
    /** 자유 관람(ADR-057, R-7 제안) */
    liveCount: '함께 관람 {n}명',
    badgeMe: '나',
    badgeTeacher: '선생님',
    nextArtwork: '다음 작품으로',
    prevArtwork: '이전 작품으로',
    menu: '메뉴',
    zoomIn: '크게 보기',
    featuredBadge: '대표작',
    collapseMore: '설명 접기',
    walkHintTouch: '조이스틱을 밀거나 바닥을 눌러 걸어가요',
    walkHintDesktop: '방향키로 걷고 바닥을 누르면 그곳으로 가요. Shift 뛰기 · 스페이스 점프',
    loadingDrawing: '미술관 계단과 첫 전시실 작품을 걸고 있어요',
    loadingSubhint: '첫 전시실이 준비되면 바로 광장으로 들어갈 수 있어요',
    joystick: '걷기 조이스틱',
    run: '뛰기',
    jump: '점프',
    /** 관람 예절 말풍선(놀이) — 실내에서 오래 뛰거나 자꾸 뛰어오를 때 */
    docent: '도슨트',
    mannerRun: '쉿! 미술관에서는 뛰지 않아요. 천천히 걸으며 작품을 봐요',
    mannerJump: '폴짝폴짝은 광장에서! 전시실에서는 살금살금 걸어요',
    /** 소리 작품 명판(크게 보기) */
    playSound: '소리 듣기',
    stopSound: '멈추기',
  },
  /** 함께 관람(ADR-057): 다른 관람객 이름표 */
  live: {
    anonymous: '관람객 {n}',
    teacher: '선생님',
    together: '함께 보는 친구 {n}명',
    alone: '혼자 둘러보는 중',
  },
  /** 2D 대체 화면(P4-10, ADR-019): 3D로 볼 수 없는 기기에서 액자를 하나씩 넘겨 본다. 나머지 글은 `viewer`의 것을 함께 쓴다 */
  view2d: {
    /** 위 줄 아래 한 줄(처음 넘기면 사라짐) */
    notice: '이 기기에서는 사진으로 둘러봐요',
    /** 캡션을 `닫기`로 접은 뒤 다시 펴는 단추 */
    showCaption: '작품 설명 보기',
  },
  reaction: {
    stickers: {
      MOVED: '감동했어요',
      LEARNED: '새로 알았어요',
      GREAT: '멋져요',
      CURIOUS: '궁금해요',
    },
    memoPlaceholder: '새로 알게 된 것을 적어요',
    scoreFact: '사실 정확성',
    scoreDelivery: '전달력',
    submit: '남기기',
    update: '고치기',
    /** `{ro}` = 받침에 맞춘 '으로/로'(`roAfter`) */
    asNickname: '{nickname}{ro} 남겨요',
    changeNickname: '바꾸기',
    queued: '잠깐 연결이 끊겼어요. 연결되면 자동으로 보낼게요',
    /** P4-6: 시트·공개 반응 표시에서 더한 문구 */
    stickerGroup: '스티커 고르기',
    memoLabel: '한 줄 메모',
    scoreCell: '{label} {max}칸 중 {n}칸',
    scorePairHint: '사실 정확성과 전달력을 모두 골라요',
    sending: '보내는 중이에요',
    sent: '보냈어요',
    noNickname: '별명 없이 남겨요',
    anonymousTeacher: '이름 없이 남겨요. 반응은 선생님만 볼 수 있어요',
    anonymousEveryone: '이름 없이 남겨요. 다른 친구들도 볼 수 있어요',
    nicknameCancel: '그대로 두기',
    artworkGone: '이 작품에는 지금 반응을 남길 수 없어요',
    publicLabel: '친구들의 반응',
    anonymous: '익명',
    memosCollapse: '접기',
    average: '{label} {avg}',
  },
  closed: {
    title: '이 전시는 막을 내렸어요',
    draft: '아직 준비 중인 전시예요',
    home: '처음으로',
  },
  /** 첫 화면 `/`(PLAN §7.3)과 전시를 불러오는 동안·다시 해 보기(P4-1) */
  entry: {
    appName: '우리들의 아트 갤러리',
    title: '입장 코드',
    hint: '선생님이 알려 준 숫자 {n}자리를 눌러요',
    codeLabel: '입장 코드 숫자 {n}자리',
    teacher: '선생님이세요?',
    loading: '전시관 문을 열고 있어요',
    retry: '다시 해 보기',
    retryHint: '조금 뒤에 다시 해 봐요',
  },
  /**
   * 별명·동의 시트(PRD 13.2 그대로). `teacherOnly`는 반응이 선생님에게만 보일 때, `everyone`은 공개 설정에 '모두에게'가
   * 있거나 별명이 함께 관람 이름표로 보일 때(PLAN §7.3, ADR-057). 굵은 글자 자리는 따로 둔다.
   */
  consent: {
    title: '반응을 남기기 전에 읽어 주세요',
    /** 입장 때(별명을 적었을 때) — 별명이 함께 관람 이름표로 보이므로 PRD 13.2 같은 내용을 들어가기 전에 */
    titleEnter: '들어가기 전에 읽어 주세요',
    storedStrong: '별명과 내가 남긴 반응',
    storedRest: '만 저장해요.',
    teacherOnly: '반응은 선생님만 볼 수 있어요.',
    everyone: '다른 친구들도 볼 수 있어요.',
    deletes: '{date}에 자동으로 지워져요. (전시를 만든 날부터 {days}일)',
    noRealInfo: '진짜 이름, 전화번호, 주소는 적지 않아요.',
    nickname: '별명',
    agree: '알겠어요',
    start: '시작하기',
    back: '돌아가기',
    offline: '잠깐 연결이 끊겨서 별명을 남기지 못했어요. 별명 없이 먼저 둘러볼 수 있어요',
    skipNickname: '별명 없이 들어가기',
  },
  /** 교사 준비실(R-7b 제안 — 교사 화면이라 기술 낱말 규칙은 학생 문구보다 느슨) */
  teacher: {
    forms: {
      LANDSCAPE: '가로',
      PORTRAIT: '세로',
      SQUARE: '정사각',
      PANORAMA: '파노라마',
      TALL: '긴 세로',
      TEXTCARD: '글 카드',
      SOUND: '소리 명판',
      MULTIPAGE: '여러 쪽',
    },
    pageCount: '{n}쪽',
    pageSplitCount: '{n}쪽 나눔',
    status: { PUBLISHED: '게시', PROCESSING: '처리 중', HIDDEN: '숨김', FAILED: '실패' },
    draggingBadge: '순서 이동 중',
    warnBlurry: '조금 흐려요',
    warnUntitled: '제목이 없어요',
    warnCheckFile: '파일 확인',
    gridPreviewHint: '모든 작품이 실제 전시실 액자·매트 비율로 미리 보입니다',
    selectedCount: '{n}개 선택됨',
    dragOrderHint: '카드를 끌어 순서를 바꾸거나 위 전시실 탭으로 옮기세요',
    addMoreArtworks: '작품 더 올리기',
    addMoreArtworksSub: '그림·PDF·소리를 놓거나 글을 붙여넣어요',
    characterButton: '선생님 캐릭터',
    characterTitle: '선생님 캐릭터 고르기',
    characterSub: '학생들과 함께 전시관을 걸을 때 보이는 선생님 모습과 머리 위 이름표예요',
    teacherMale: '선생님 A',
    teacherFemale: '선생님 B',
    nameplateLabel: '전시관 이름표',
    nameplateHint: '학생들에게 선생님 배지와 함께 보여요',
    characterSave: '이 캐릭터로 저장하기',
    cancel: '취소',
    /** 반응 내려받기(CSV) 머리·값·파일 이름 앞말 */
    csv: {
      artwork: '작품',
      room: '전시실',
      sticker: '스티커',
      memo: '메모',
      nickname: '별명',
      time: '시각',
      hidden: '숨김',
      yes: '예',
      no: '아니오',
      anonymous: '익명',
      filePrefix: '반응',
    },
  },
} as const;

/** 정면 이름판 글(ADR-057): 전시명이 '전시관·미술관·박물관·전시회·갤러리'로 끝나면 그대로, 아니면 "{전시명} 전시관" */
export const facadeTitle = (title: string): string => {
  const t = title.trim();
  return copy.viewer.facadeSuffixes.some(s => t.endsWith(s)) ? t : fill(copy.viewer.facadeSign, { title: t });
};

/**
 * 낱말 뒤 조사 '으로/로': 마지막 글자가 받침 없는 한글이거나 받침이 ㄹ이면 '로', 받침이 있으면 '으로'.
 * 한글이 아니면(영문·숫자) 둘 다 맞게 '(으)로'.
 */
export const roAfter = (word: string): string => {
  const last = [...word.trim()].pop();
  if (!last) return '(으)로';
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '(으)로';
  const jong = code % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
};

/** `{name}` 자리를 채운다. 없는 값은 그대로 둔다(문구 빠짐을 시험에서 잡기 위해). */
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole,
  );
