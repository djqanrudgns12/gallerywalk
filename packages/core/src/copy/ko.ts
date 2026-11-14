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
    /** 3D 준비가 늦을 때(G-24 HW-01): 입장 단추를 풀고 그 위에 한 줄 — 누르면 가벼운 화면으로 들어간다 */
    slowHint: '가벼운 화면으로 먼저 볼게요',
    openUntil: '{date}까지 열려요',
    inAppBrowserHint: '소리가 안 나면 Safari나 Chrome으로 열어 주세요',
    /** 입장·캐릭터 고르기(ADR-057, R-7 제안) */
    nicknameLabel: '내 별명',
    nicknameHint: '캐릭터 머리 위 이름표와 감상 메모에 보여요',
    /** 교실 공용 기기(U-20): 앞 친구의 별명·반응 기록 없이 새로 시작 */
    freshStart: '처음 쓰는 친구예요',
    freshStarted: '새 관람객으로 시작해요',
    nicknamePlaceholder: '전시관에서 부를 별명을 적어 주세요',
    characterLabel: '내 캐릭터 고르기',
    characterHint: '전시관을 걸어 다닐 모습을 골라요',
    studentMale: '학생 A',
    studentFemale: '학생 B',
    /** 캐릭터 10종 고르기 칸의 화면 읽기 이름(M4-9): 줄 이름(학생 A·B) + 번호 */
    characterNumber: '{group} {n}번',
    togetherNotice: '같은 전시관에 들어온 친구들과 별명을 보며 함께 걸어요',
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
    /** 반응 단추의 작은 점(보내지 못한 반응이 기기에 남음) */
    reactPending: '아직 보내지 못한 반응이 있어요',
    pageOf: '{page}/{total}',
    rotateHint: '가로로 돌리면 더 크게 보여요',
    continueReading: '이어서 보기',
    /** 작품 명판 셋째 줄: 여러 쪽 작품의 쪽 수(V-23) */
    platePages: '{n}쪽 작품',
    updated: '전시가 새로 바뀌었어요',
    updatedAction: '새로 보기',
    waitAMoment: '잠시만 기다려 주세요',
    exitThanks: '관람해 주셔서 고마워요',
    /** 출구 안내판 제목(V-57): 3D 출구 사인의 감사 문구와 겹치지 않게 다른 말 */
    exitPanelTitle: '전시를 다 둘러봤어요',
    /** 3D 안 사인(V-03): 홀 천장 사인 아래 줄 · 출구 사인 이름 */
    signHall: '어서 오세요',
    signExit: '출구',
    exitCount: '작품 {n}점',
    restart: '처음부터 다시 보기',
    /** 미술관 정면 이름판(ADR-057): 전시명이 이미 '전시관·미술관·박물관·전시회'로 끝나면 전시명 그대로 */
    facadeSign: '{title} 전시관',
    /** 전시명이 이 말로 끝나면 이름판에 전시명 그대로 */
    facadeSuffixes: ['전시관', '미술관', '박물관', '전시회', '전시', '갤러리'] as readonly string[],
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
    loadingDrawing: '전시관 계단과 첫 전시실 작품을 걸고 있어요',
    loadingSubhint: '첫 전시실이 준비되면 바로 광장으로 들어갈 수 있어요',
    joystick: '걷기 조이스틱',
    run: '뛰기',
    runLocked: '잠깐 뛰기를 쉬고 있어요. 천천히 걸어 주세요',
    jump: '점프',
    /** 관람 예절 말풍선(놀이) — 실내에서 오래 뛰거나 자꾸 뛰어오를 때 */
    docent: '도슨트',
    mannerRun: '쉿! 전시관에서는 뛰지 않아요. 천천히 걸으며 작품을 봐요',
    mannerJump: '폴짝폴짝은 광장에서! 전시실에서는 살금살금 걸어요',
    /** 소리 작품 명판(크게 보기) */
    playSound: '소리 듣기',
    stopSound: '멈추기',
    /** 걷기 화면 아래 이동 단추 묶음의 이름(화면 읽기, V-35) */
    walkNav: '작품 사이 이동',
    /** 휴대폰 세로 크게 보기 캡션: 한 줄로 접힌 판 펼치기·접기(PRD 9.5, V-15) */
    captionUnfold: '펼치기',
    captionFold: '접기',
  },
  /** 관람 조작 v2(PRD 19장 G-27, PRD_V2 W-01·W-06·W-07·W-08): 행동 단추·경계·부딪힘·나가기 */
  museumWalk: {
    actionJump: '점프',
    actionTalk: '말걸기',
    actionExit: '나가기',
    /** 데스크톱에서 도슨트·대문 가까이 가면 아래 가운데 작은 표시 */
    keyHint: '스페이스 {action}',
    boundary: '바깥으로는 이동할 수 없어요',
    bump: '부딪히지 않게 조심해 주세요',
    exitTitle: '관람을 마칠까요?',
    exitStats: '작품 {seen}점을 보고 반응 {reacted}개를 남겼어요',
    exitStatsNone: '천천히 둘러봐 줘서 고마워요',
    exitLeave: '나가기',
    exitRejoin: '재접속하기',
    exitStay: '계속 둘러보기',
    liveLost: '연결이 잠시 끊겼어요',
    liveRejoin: '재접속하기',
    /** 홀 안내 토템 제목(공간 v4 안내판 ⑤) */
    signTotem: '전시실 안내',
  },
  /**
   * 도슨트 대사(PRD_V2 §6, W-10): 관람 예절. 근거는 국립중앙박물관·국립현대미술관·예술의전당 관람 안내(PRD_V2 §13).
   * `lines`는 번호 순서, `zones`는 자리마다 쓰는 줄 번호(1부터). `말걸기`·이따금 말풍선 모두 이 안에서 섞은 주머니 순서로.
   */
  museumDocent: {
    name: '도슨트',
    talkCard: '도슨트의 관람 안내',
    close: '닫기',
    lines: [
      '여기서는 작은 소리도 크게 울려요. 목소리를 살짝 낮춰 볼까요?',
      '작품은 눈으로만 봐요. 손대거나 기대지 않기로 약속해요.',
      '전시실에서는 뛰지 않고 천천히 걸어요. 그래야 그림을 더 오래 볼 수 있어요.',
      '발소리도 사뿐사뿐, 소리가 안 나게 걸어 볼까요?',
      '진짜 미술관에 가면 휴대전화는 진동으로! 통화는 전시실 밖에서 해요.',
      '사진은 플래시를 끄고 찍어요. 센 빛은 그림 색을 바래게 할 수 있거든요.',
      '사진을 찍어도 되는지 헷갈리면 안내하는 사람에게 먼저 물어봐요.',
      '간식과 음료는 전시실 밖에서 먹어요.',
      '진짜 미술관에서는 큰 가방을 보관함에 맡기고 가볍게 둘러봐요.',
      '다른 친구가 보는 걸 가리지 않게 조금씩 비켜 서 줄까요?',
      '눈을 크게 뜨고 그림을 천천히 살펴봐요. 숨은 걸 찾아볼까요?',
      '그림 속 주인공이 되었다고 상상해 볼까요? 무슨 이야기가 들리나요?',
      '어떤 느낌이 들었는지 친구와 작은 목소리로 이야기 나눠 봐요.',
      '작품이 다치면 되돌리기 어려워요. 그래서 모두 조심조심 보는 거예요.',
      '안내하는 사람의 말을 잘 들어 주세요. 그래야 모두 즐겁게 볼 수 있어요.',
      '노래나 놀이는 광장에서 해요. 전시실은 조용히 보는 곳이에요.',
      '어서 오세요! 계단을 올라 전시관으로 들어가 볼까요?',
      '길을 잃으면 이 큰 홀로 돌아오면 돼요. 지도도 있어요.',
    ],
    zones: {
      plaza: [2, 3, 5, 8, 9, 15, 16, 17],
      hall: [1, 2, 4, 5, 6, 7, 8, 13, 14, 15, 18],
      room: [1, 2, 3, 4, 6, 10, 11, 12, 13, 14, 16],
    },
  },
  /** 함께 관람(ADR-057): 다른 관람객 이름표 */
  live: {
    anonymous: '관람객 {n}',
    teacher: '선생님',
    alone: '혼자 둘러보는 중',
  },
  /** 2D 대체 화면(P4-10, ADR-019): 3D로 볼 수 없는 기기에서 액자를 하나씩 넘겨 본다. 나머지 글은 `viewer`의 것을 함께 쓴다 */
  view2d: {
    /** 위 줄 아래 한 줄(처음 넘기면 사라짐) */
    notice: '이 기기에서는 사진으로 둘러봐요',
    /** 캡션을 `닫기`로 접은 뒤 다시 펴는 단추 */
    showCaption: '작품 설명 보기',
    /** 위 줄 아래 전시실 바로 가기 묶음의 이름(화면 읽기, V-35) */
    rooms: '전시실 고르기',
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
    /** 첫 화면 큰 제목 두 줄(F8 V-52) */
    headline: ['전시관에', '들어가요'],
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
    titleEnter: '입장하기 전에 읽어 주세요',
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
    skipNickname: '별명 없이 입장하기',
  },
  /** 자동 투어(P5-9, G-16) — 교사가 교실 화면에 띄운다 */
  tour: {
    start: '투어 시작하기',
    startHint: '전시관을 처음부터 끝까지 천천히 둘러봐요. 소리가 함께 나와요',
    pause: '잠깐 멈추기',
    play: '이어 보기',
    restart: '처음부터',
    exit: '투어 끝내기',
    progress: '투어 진행',
    time: '{now} / {total}',
    loading: '투어를 준비하고 있어요',
    empty: '게시한 작품이 있어야 투어를 볼 수 있어요',
    back: '전시 관리로',
  },
  /**
   * 개인정보처리방침 `/privacy`(P6-8, PRD 13.3, PLAN §9.6 "보장 범위"·§11.5). 위는 초5가 읽는 쉬운 글, 아래는 보호자·선생님용
   * 자세한 항목(접기). `{days}`·`{sec}`·`{cdnDays}`·`{perfDays}`는 화면이 `config.ts` 값으로 채운다.
   */
  privacy: {
    link: '개인정보처리방침',
    title: '개인정보처리방침',
    lead: '우리들의 아트 갤러리가 어떤 정보를 왜 저장하고, 언제 지우는지 알려 드려요',
    easyTitle: '쉽게 읽어요',
    easy: [
      '전시를 볼 때는 아무것도 적지 않아도 돼요.',
      '반응을 남길 때만 별명과 내가 남긴 반응, 남긴 시각을 저장해요.',
      '진짜 이름, 전화번호, 주소는 적지 않아요.',
      '화면이 잘 뜨는지 살피려고 기기 종류와 걸린 시간을 누구 것인지 모르게 모아요.',
      '전시를 만든 날부터 {days}일이 지나면 모두 저절로 지워져요.',
      '다른 회사나 다른 사람에게 주지 않아요. 인공지능(AI)에게 보내지도 않아요.',
    ],
    more: '보호자·선생님께 — 자세히 보기',
    sections: [
      {
        title: '모으는 정보',
        items: [
          '반응을 남긴 경우: 별명, 반응 내용(스티커·메모·평가), 기기 식별값(기기가 만든 무작위 값), 남긴 시각',
          '선생님: 학교·학급 이름(적었을 때만)',
          '관람할 때: 화면이 뜨는 데 걸린 시간, 움직임의 부드러움, 기기·브라우저 종류(예: 안드로이드 태블릿·크롬). 누구 것인지 알 수 없는 값만 모으고 {perfDays}일 뒤 지워요.',
          '실명을 받는 칸은 없어요. 작품 파일에 담긴 위치(GPS) 같은 정보는 받는 즉시 지워요.',
        ],
      },
      { title: '쓰는 곳', items: ['전시 관람과 수업 피드백에만 써요.'] },
      {
        title: '보관과 파기',
        items: [
          '전시를 만든 날부터 {days}일 동안 보관하고, 그 뒤 자동으로 파기해요. 보관 기간은 설정에 따라 바뀔 수 있어요.',
          '따로 백업하지 않아요.',
        ],
      },
      {
        title: '지워지는 범위',
        items: [
          '서버 원본: 만료 시각에 바로 열 수 없게 되고, {sec}초 안에 지워져요.',
          'CDN 사본: 길어야 {cdnDays}일 남아 있어요. 파일 주소를 아는 사람만 받을 수 있어요.',
          '기기 사본: 그 기기에서 앱을 다음에 열 때 지워져요.',
        ],
      },
      {
        title: '제3자 제공과 외부 AI',
        items: [
          '제3자에게 제공하지 않아요.',
          'CDN(CloudFront·Cloudflare)은 파일을 전해 주는 일만 맡아요.',
          '외부 AI 서비스를 쓰지 않아요.',
        ],
      },
      {
        title: '만 14세 미만 어린이',
        items: [
          '이용자 대부분이 만 14세 미만 어린이라서 실명 대신 별명을 쓰도록 안내해요.',
          '학교에서 쓸 때는 교내 개인정보 보호 절차를 먼저 확인해 주세요.',
        ],
      },
    ],
    operatorTitle: '운영자',
    operatorName: '운영자',
    operatorContact: '연락처',
    operatorEffective: '시행일',
    /** 운영자 정보(U-10, 사용자가 정함). 이 세 값만 채우면 화면에 나온다 — 비어 있으면 `blank` 표시 */
    operatorInfo: { name: '', contact: '', effectiveDate: '' },
    blank: '빈칸 · 정해지면 채워요',
    back: '돌아가기',
  },
  /**
   * 학교망 점검 `/check`(G-24 HW-00·HW-07): 선생님·정보 담당이 학교 와이파이에 붙은 기기로 연다. 선생님 화면이라
   * 기술 낱말은 `자세히`와 요청 글에만 쓴다. 단계 이름은 `steps`, 결과 한 줄은 `summary`. `{n}`·`{sec}` 등은 화면이 채운다.
   */
  check: {
    title: '학교망 점검',
    lead: '이 기기와 지금 와이파이로 전시관에 들어갈 수 있는지 하나씩 확인해요. 1분쯤 걸려요',
    codeLabel: '입장 코드(적으면 그 전시의 작품 그림까지 확인해요)',
    start: '점검 시작하기',
    again: '다시 점검하기',
    steps: {
      server: '전시관에 닿기',
      app: '화면 파일 받기',
      space: '3D 공간 파일 받기',
      decoder: '3D 변환 도구 받기',
      artwork: '작품 그림 받기',
      live: '함께 관람 연결',
      speed: '받는 빠르기',
      webgl: '이 기기의 3D 그리기',
    },
    state: {
      waiting: '기다려요',
      running: '확인하고 있어요',
      ok: '됨',
      slow: '느림',
      fail: '막힘',
      skip: '건너뜀',
    },
    took: '{sec}초',
    speedValue: '초당 {mbps}Mbps',
    summary: {
      ok: '모두 됐어요. 이 와이파이에서 전시관에 들어갈 수 있어요',
      slow: '들어갈 수는 있지만 느려요. 한 반이 함께 들어가면 3D 대신 가벼운 화면으로 보는 학생이 생길 수 있어요',
      blocked: '막힌 곳이 있어요. 아래 글을 학교 정보 담당 선생님께 보내 주세요',
      unreachable:
        '전시관에 닿지 않아요. 휴대폰 핫스팟 같은 다른 망에서 열어 보고, 거기서는 되면 아래 글을 정보 담당 선생님께 보내 주세요',
      no3d: '이 기기는 3D 그리기를 쓸 수 없어요. 학생은 가벼운 화면으로 관람해요',
    },
    details: '자세히',
    copy: '결과 복사하기',
    copied: '복사했어요',
    copyFailed: '복사하지 못했어요. 아래 글을 길게 눌러 복사해 주세요',
    requestTitle: '정보 담당 선생님께 보낼 글',
    /**
     * 허용 요청 글(HW-07, `docs/school-network.md`와 같은 내용). `{host}` = 전시관 주소, `{date}` = 점검 시각,
     * `{device}` = 이 기기 갈래, `{result}` = 단계별 결과 줄들
     */
    request: [
      '[웹 사이트 접속 허용 요청] 우리들의 아트 갤러리(학급 온라인 전시관)',
      '',
      '수업에서 학생 태블릿으로 아래 주소를 엽니다. 학생 와이파이에서 막히거나 느린 곳이 있어 허용을 부탁드립니다.',
      '',
      '- 주소: https://{host} (하위 경로 전체)',
      '- 포트: 443 (HTTPS, 같은 주소의 WebSocket wss:// 포함)',
      '- 받는 파일 종류: text/html, text/javascript, text/css, application/json, application/wasm, model/gltf-binary(.glb), image/ktx2, image/webp, image/avif, image/jpeg, audio/mpeg, font/woff2',
      '- 첫 입장 때 학생 한 명이 받는 양: 약 5MB(3D 공간·작품 그림), 이후 작품마다 수백 KB',
      '- 새로 등록한 도메인이라 "미분류·신규 도메인"으로 걸러질 수 있습니다. 교육·학습 분류로 허용 부탁드립니다',
      '- HTTPS 검사(복호화) 장비가 있으면 위 주소는 검사에서 빼 주시면 3D 파일·실시간 연결이 끊기지 않습니다',
      '',
      '점검 결과({date}, {device}):',
      '{result}',
    ],
    privacyNote: '점검 결과는 이 기기에만 보여요. 서버에 남기지 않아요',
    /** 선생님 첫 화면·수업 화면에서 이 화면으로 가는 링크 */
    link: '학교망 점검',
    back: '돌아가기',
  },
  /**
   * 실기기 숫자판(`?perf=1`, G-25 HS-00·ADR-070): 학교 현장에서 선생님이 사진으로 남기는 작은 표. 주소에 붙였을 때만 보인다.
   * 학생이 보는 기본 화면이 아니라 기술 이름을 그대로 쓴다.
   */
  perf: {
    label: '성능 숫자',
    fps: 'fps',
    frameP95: '프레임 p95',
    inputP95: '누름 반응 p95',
    longTasks: '긴 작업',
    live: '함께 관람 받는 양',
    peers: '보이는 사람',
    tier: '품질 단계',
    device: '기기',
    timeline: '포스터 · 준비 · 입장 · 첫 그림',
    ms: '{n}ms',
    sec: '{n}초',
    kbps: '{n}KB/초',
    none: '-',
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
    /** 끌어 옮기기 안내(P5-C, 화면 읽기 프로그램·키보드). `{name}` = 작품 제목 또는 전시실 이름 */
    dnd: {
      instructions:
        '옮기려면 M 키로 집고 화살표로 자리를 고른 뒤 Space나 Enter로 놓아요. Esc를 누르면 그만둬요. 손가락은 길게 누른 채 끌어요.',
      picked: '{name} 집음',
      over: '{name} 자리',
      overRoom: '{name}{ro} 옮겨요',
      dropped: '{name} 놓음',
      cancelled: '옮기기를 그만뒀어요',
      roleCard: '옮길 수 있는 작품',
      roleRoom: '옮길 수 있는 전시실',
    },
    warnBlurry: '조금 흐려요',
    warnUntitled: '제목이 없어요',
    warnCheckFile: '파일 확인',
    gridPreviewHint: '모든 작품이 실제 전시실 액자·매트 비율로 미리 보여요',
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
    characterSaved: '선생님 캐릭터를 바꿨어요',
    /** 글 붙여넣기 시트(V-01, G-10): 지금 전시실 끝에 글 작품 하나 */
    paste: {
      title: '글 붙여넣기',
      titleLabel: '제목',
      bodyLabel: '글',
      bodyHint: '줄바꿈은 그대로 보여요. 지금 전시실 끝에 글 작품으로 들어가요',
      titleRequired: '제목을 적어 주세요',
      bodyRequired: '글을 붙여넣어 주세요',
      bodyTooLong: '글은 {max}자까지 넣을 수 있어요. 지금 {n}자예요',
      save: '글 작품 넣기',
    },
    cancel: '취소',
    /** 전시 상태 점(준비 중·열림·닫힘) */
    exhibitionStatus: { DRAFT: '준비 중', OPEN: '열림', CLOSED: '닫힘' },
    /** 선생님 첫 화면 `/t`(P5-1) */
    home: {
      title: '선생님 전시실',
      recentTitle: '최근 전시',
      empty: '이 기기에서 연 전시가 아직 없어요. 새 전시를 만들거나 PIN으로 들어가요',
      deletesOn: '{date}에 지워져요',
      pinEnter: 'PIN으로 들어가기',
      create: '새 전시 만들기',
      linkOpening: '선생님 링크로 들어가는 중이에요',
    },
    /** PIN 칸·키패드(G-17, ADR-024) */
    pin: {
      title: 'PIN으로 들어가기',
      label: '선생님 PIN',
      hint: '전시를 만들 때 정한 숫자 {min}~{max}자리를 눌러요',
      createHint: '숫자 {min}~{max}자리예요. 8자리면 더 안전해요',
      format: 'PIN은 숫자 {min}~{max}자리예요',
      entered: '{label} {n}자리 입력함',
      submit: '들어가기',
      submitting: '확인하고 있어요',
      clear: '모두 지우기',
      backspace: '한 칸 지우기',
      backspaceShort: '지우기',
    },
    /** 새 전시 만들기(P5-2, G-09) */
    create: {
      title: '새 전시 만들기',
      back: '선생님 전시실로',
      name: '전시 이름',
      namePlaceholder: '예: S.O.S. 연대기 전시관',
      nameRequired: '전시 이름을 적어 주세요',
      charCount: '{n}/{max}',
      optional: '선택',
      template: '템플릿',
      soon: '준비 중',
      templates: {
        'modern-history': { name: '근대 역사관', desc: '연도순으로 걷는 일직선 회랑' },
      },
      /** 아직 준비 중인 템플릿(누를 수 없음, v1.1) */
      upcomingTemplates: [
        { name: '한옥 전시관', desc: 'ㅁ자 마당을 도는 회랑' },
        { name: '화이트 큐브', desc: '문으로 이어지는 흰 방' },
        { name: '클래식 미술관', desc: '원형 홀과 둘레의 방' },
        { name: '별빛 나이트 뮤지엄', desc: '원을 그리는 어두운 동선' },
      ] as readonly { readonly name: string; readonly desc: string }[],
      subtitle: '한 줄 소개',
      subtitleHint: '포스터 화면에 보여요',
      startCode: '선생님 시작 코드',
      startCodeHint: '이 기기에서 처음 전시를 만들 때만 한 번 적어요',
      more: '더 설정하기',
      poster: '포스터 이미지',
      school: '학교·학급 표시',
      schoolHint: '포스터에 학교와 학급을 함께 보여 줘요',
      schoolName: '학교',
      className: '학급',
      tour: '자동 투어 시간',
      tourMusic: '노래 길이에 맞춤',
      tourFixed: '전시실마다 정한 시간',
      tourMusicHint: '전시실마다 그 방 배경음악이 끝날 때까지 둘러봐요. 음악이 없는 방은 {n}초예요',
      tourSecondsLabel: '전시실마다',
      secondsUnit: '초',
      tourRange: '{min}~{max}초 사이로 정해 주세요',
      submit: '전시 만들기',
      submitting: '만들고 있어요',
      createdToast: '이 전시는 오늘부터 {days}일 동안 열 수 있어요',
      schoolSaveFailed: '전시를 만들었어요. 학교·학급 표시는 저장하지 못했어요',
      /** 포스터 고르기(V-02, G-09): 전시를 만든 직후 올린다 */
      posterPick: '포스터 그림 고르기',
      posterChange: '다른 그림 고르기',
      posterRemove: '빼기',
      posterChosen: '고른 그림: {name}',
      posterHint: '고르지 않으면 전시 이름으로 포스터를 만들어요',
      posterSaveFailed: '전시를 만들었어요. 포스터 이미지는 올리지 못했어요',
      extrasSaveFailed: '전시를 만들었어요. 학교·학급 표시와 포스터 이미지는 저장하지 못했어요',
    },
    /** 반응 설정(G-07 표) — 새 전시의 `더 설정하기`와 열기 시트의 `바꾸기` */
    reactionSettings: {
      title: '반응 설정',
      enabled: '반응 받기',
      on: '켬',
      off: '끔',
      collect: '받을 것',
      sticker: '스티커',
      memo: '한 줄 메모',
      score: '별점',
      naming: '이름 방식',
      nickname: '별명',
      anonymous: '익명',
      stickerVisibility: '스티커 공개',
      memoVisibility: '메모 공개',
      scoreVisibility: '별점 공개',
      teacherOnly: '선생님만',
      everyone: '모두에게',
      selected: '고른 것만 모두에게',
      nothingCollected: '받을 것을 하나 이상 골라 주세요',
      summary: '반응: {items}',
      summaryOff: '반응: 받지 않음',
      summarySticker: '스티커',
      summaryMemo: '메모',
      summaryScore: '별점',
      summaryScoreOff: '별점 꺼짐',
      change: '바꾸기',
      save: '저장하기',
    },
    /** 전시 열기 시트(P5-7, G-14) */
    open: {
      title: '전시 열기',
      openedTitle: '전시가 열렸어요',
      open: '열기',
      opening: '여는 중이에요',
      shortUrl: '짧은 주소',
      entryCode: '입장 코드',
      bigQr: 'QR 크게 띄우기',
      qrLabel: '{url} 주소 QR',
      studentHint: '학생은 주소로 들어오거나 첫 화면에서 입장 코드를 눌러요',
    },
    /** `···` 메뉴(P5-7, PLAN §7.4·§11.1) */
    menu: {
      trigger: '전시 메뉴',
      tour: '자동 투어',
      preload: '수업 전 미리 불러오기',
      showQr: 'QR·주소 다시 보기',
      copyLink: '선생님 링크 복사',
      copyLinkWarn: '학생에게 보이지 않게 하세요',
      copied: '선생님 링크를 복사했어요',
      copyFailed: '복사하지 못했어요. 다시 해 주세요',
      rotate: '선생님 링크 새로 만들기',
      rotateTitle: '선생님 링크를 새로 만들까요?',
      rotateBody: '이전 링크는 더 이상 열리지 않아요. PIN으로 들어온 기기는 그대로 쓸 수 있어요',
      rotateConfirm: '새로 만들기',
      rotated: '새 선생님 링크를 만들었어요',
      close: '전시 닫기',
      closed: '전시를 닫았어요. 학생은 새로 들어올 수 없어요',
      reopen: '다시 열기',
      reopened: '전시를 다시 열었어요',
      deleteNow: '지금 삭제',
      deleteTitle: '이 전시를 지금 삭제할까요?',
      deleteBody: '작품·반응·입장 코드·PIN이 모두 지워지고 되살릴 수 없어요',
      deleteWait: '{n}초 뒤에 누를 수 있어요',
      deleteConfirm: '지금 삭제',
      deleting: '삭제하고 있어요',
      /** 포스터(V-02) */
      posterPick: '포스터 이미지 고르기',
      posterChange: '포스터 바꾸기',
      posterRemove: '포스터 빼기',
      posterUploading: '포스터를 올리고 있어요',
      posterSaved: '포스터를 바꿨어요',
      posterRemoved: '포스터를 뺐어요. 전시 이름으로 포스터를 보여 줘요',
      /** 반응·투어 설정(V-17, G-07 "언제든"·G-16) — 연 뒤에도 바꾼다. `{sec}` = `CHANGE_POLL_SEC` */
      settings: '반응·투어 설정',
      settingsSaved: '설정을 저장했어요',
      settingsSavedOpen: '설정을 저장했어요. 학생 화면에는 {sec}초 안에 바뀌어요',
    },
    /** 수업 전 미리 불러오기 시트(P5-10, PLAN §7.4·§6.13, ADR-049) — 전시 전체를 이 기기에 받아 둔다 */
    preload: {
      title: '수업 전 미리 불러오기',
      intro: '작품·배경음악·전시관을 모두 이 기기에 받아 둬요. 수업 중에 끊기지 않고 볼 수 있어요',
      loading: '받고 있어요',
      count: '{done}/{total}개',
      saved: '{mb}MB 저장했어요',
      progress: '미리 불러오기 진행',
      keepGoing: '시트를 닫아도 계속 받아요',
      ready: '다 받았어요 · {mb}MB',
      noSpace: '이 기기에 저장할 공간이 모자라요',
      unavailable: '이 브라우저에서는 미리 불러올 수 없어요',
      failed: '다 받지 못했어요. 연결을 확인하고 다시 해 주세요',
      empty: '게시한 작품이 있어야 미리 불러올 수 있어요',
      retry: '다시 받기',
      close: '닫기',
      /** 자동 투어 시작 덮개의 한 줄(PLAN §6.13) */
      tourHint: '수업 전 미리 불러오기를 먼저 하면 끊김이 없어요',
    },
    /** 반응 탭(P5-8, G-15) */
    reactionsTab: {
      title: '반응',
      download: '내려받기',
      downloading: '내려받는 중이에요',
      loading: '반응을 불러오고 있어요',
      empty: '아직 받은 반응이 없어요',
      untitled: '제목 없는 작품',
      memoCount: '메모 {n}',
      scoreAvg: '사실 정확성 {fact} · 전달력 {delivery}',
      noMemos: '아직 메모가 없어요',
      hide: '숨기기',
      unhide: '다시 보이기',
      hiddenBadge: '숨김',
      select: '모두에게 보이기',
      unselect: '공개 취소',
      selectedBadge: '모두에게 보임',
    },
    /** 전시 관리 작품 탭(P5-4, G-10·G-13) */
    manage: {
      titleLabel: '전시 이름',
      deletesOn: '{date}에 지워져요',
      loading: '전시를 불러오고 있어요',
      goHome: '선생님 첫 화면으로',
      upload: '작품 올리기',
      open: '전시 열기',
      tabsLabel: '전시 관리',
      tabArtworks: '작품',
      tabReactions: '반응',
      roomsLabel: '전시실',
      roomDefault: '전시실 {n}',
      roomCount: '{n}점',
      roomEditHint: '한 번 더 누르면 전시실을 고쳐요',
      addRoom: '전시실 더하기',
      checkUntitled: '제목이 없는 작품 {n}개',
      checkBlurry: '흐린 작품 {n}개',
      untitled: '제목 없는 작품',
      emptyRoom: '이 전시실에는 아직 작품이 없어요',
      sideLabel: '작품 고치기',
      sideHint: '작품을 누르면 오른쪽에서 고칠 수 있어요',
      batchLabel: '고른 작품',
      batchHide: '숨기기',
      batchPublish: '게시',
      batchMove: '전시실 옮기기',
      clearSelection: '고르기 풀기',
      retrySave: '다시 시도',
      saveFailed: '저장하지 못했어요',
      charCount: '{n}/{max}',
      /** 3D 미리 보기(P5-6, G-13): 학생 화면과 같은 장면. 작품을 누르면 그 작품 패널 */
      preview: '미리 보기',
      previewHint: '학생이 보는 그대로예요. 작품을 누르면 바로 고칠 수 있어요',
      previewClose: '미리 보기 닫기',
      previewLoading: '미리 보기를 준비하고 있어요',
      previewNo3d: '이 기기에서는 3D 미리 보기를 볼 수 없어요',
      previewEmpty: '게시한 작품이 있어야 미리 볼 수 있어요',
      /** 축측 지도(G-32, HT-04) */
      mapLabel: '전시 지도',
      mapEntry: '입구',
      mapPeople: '{n}명',
      mapEmpty: '게시한 작품이 있으면 지도가 그려져요',
    },
    /** 올리기(P5-3, PLAN §5.2·§5.3). 막힘 문구는 `errorCopy`, 해결법은 `fix` */
    upload: {
      dropTitle: '작품 파일이나 폴더를 여기에 놓아요',
      /** 휴대폰(V-19, G-10 "휴대폰에서는 파일 선택만"): 끌어 놓기·폴더 안내 대신 */
      dropTitlePhone: '작품 파일을 골라 올려요',
      dropHint: '폴더째 놓으면 폴더마다 전시실이 생기고, 소리 파일은 배경음악이 돼요',
      dropStrip: '파일이나 폴더를 화면 어디에 놓아도 올라가요',
      dropHere: '놓으면 올려요',
      pickFiles: '파일 고르기',
      pickFolder: '폴더 고르기',
      /** 놓기 영역 아래 작은 링크(V-01) */
      pasteText: '글 붙여넣기',
      trayTitle: '올리는 작품',
      trayCount: '올리기 {done}/{total}',
      /** 올리는 작품 목록에서 끝난 줄만 치운다(작품은 그대로 — `삭제`와 헷갈리지 않게, V-37) */
      clear: '끝난 것 목록에서 빼기',
      bgm: '배경음악',
      checking: '살펴보는 중',
      waiting: '차례를 기다리는 중',
      sending: '올리는 중 {pct}%',
      confirming: '올라갔는지 확인하는 중',
      done: '올렸어요',
      failed: '올리지 못했어요',
      lowRes: '조금 흐리게 보일 수 있어요',
      /** 올리기 결과 한 줄(V-18, PRD 6.9): 그림을 쪽으로 나눠 보여 줄 때. `{n}` = 쪽 수 */
      splitTall: '웹툰이라 {n}쪽으로 나눠 보여 줘요',
      splitPanorama: '파노라마라 {n}쪽으로 나눠 보여 줘요',
      splitText: '글이 많아 {n}쪽으로 나눠 보여 줘요',
      /** PDF(P5-C): 기기에서 쪽마다 그림을 만든 뒤 올린다 */
      rendering: '쪽 그림 만드는 중 {done}/{total}',
      sendingPages: '올리는 중 {done}/{total}쪽',
      fix: {
        tooLarge: '그림은 {image}MB, 소리는 {audio}MB 이하로 줄여 주세요',
        broken: '파일을 다시 저장한 뒤 올려 주세요',
        textLength: '{n}자 이하로 나눠 주세요',
        duplicate: '격자에서 같은 작품을 찾아보세요',
        quota: '쓰지 않는 작품을 지운 뒤 올려 주세요',
        offline: '연결되면 다시 올려 주세요',
        fileTypeWithPdf: 'PNG·JPG·WebP·GIF·HEIC 그림, PDF, MP3·M4A·WAV 소리를 올려 주세요',
        pdfBroken: '암호를 풀거나 다시 저장한 PDF를 올려 주세요',
        /** `E_HEIC_UNSUPPORTED`(PRD 6장 "JPG로 다시 올려 주세요") 옆 이유·방법 — HEIC는 보통 받지만 바꾸지 못한 파일만(V-37) */
        heic: '이 HEIC 사진은 JPG로 바꾸지 못했어요. 아이폰 설정 → 카메라 → 포맷에서 높은 호환성을 고르면 JPG로 찍혀요',
      },
    },
    /** 작품 패널(P5-5, G-11) */
    panel: {
      title: '제목',
      close: '닫기',
      author: '작가',
      addAuthor: '작가 더하기',
      addDescription: '설명 더하기',
      caption: '한 줄 설명',
      description: '긴 설명',
      editText: '글 고치기',
      textBody: '글',
      order: '순서',
      earlier: '앞으로',
      later: '뒤로',
      autoValues: '자동으로 정한 것',
      room: '전시실',
      form: '형태·액자',
      auto: '자동',
      pageMode: '쪽 나눔',
      pageSingle: '한 장으로 보기',
      textHeavy: '글이 많은 작품',
      featured: '대표작',
      hide: '숨기기',
      publish: '게시하기',
      delete: '삭제',
      deleted: '삭제했어요',
      restore: '되살리기',
    },
    /** 편집 되돌리기(HT-08). `{eul}` = 제목 뒤 '을/를'(`eulReul`), `{ro}` = 전시실 이름 뒤 '으로/로'(`roAfter`) */
    undo: {
      action: '되돌리기',
      moved: '‘{title}’{eul} {n}번째로 옮겼어요',
      movedRoom: '‘{title}’{eul} ‘{room}’{ro} 옮겼어요',
      movedMany: '작품 {n}점을 ‘{room}’{ro} 옮겼어요',
      hidden: '‘{title}’{eul} 숨겼어요',
      published: '‘{title}’{eul} 게시했어요',
      hiddenMany: '작품 {n}점을 숨겼어요',
      publishedMany: '작품 {n}점을 게시했어요',
      undone: '되돌렸어요',
      nothing: '되돌릴 것이 없어요',
    },
    /** 전시실 시트(P5-5, G-12) */
    roomSheet: {
      name: '이름판',
      intro: '소개 글',
      bgm: '배경음악',
      bgmNone: '배경음악이 없어요',
      bgmUpload: '배경음악 올리기',
      bgmReplace: '바꾸기',
      bgmRemove: '빼기',
      bgmPreview: '배경음악 미리 듣기',
      deleteRoom: '이 전시실 삭제',
      deleteConfirm: '작품 {n}개는 {room}{ro} 옮겨져요',
      deleteYes: '삭제',
      deleteNo: '그대로 두기',
      lastRoom: '전시실이 하나뿐이라 작품이 있으면 지울 수 없어요',
    },
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

/** 낱말 뒤 목적격 조사 '을/를': 받침이 있으면 '을', 없으면 '를'. 한글이 아니면 '을(를)' */
export const eulReul = (word: string): string => {
  const last = [...word.trim()].pop();
  if (!last) return '을(를)';
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '을(를)';
  return code % 28 === 0 ? '를' : '을';
};

/** `{name}` 자리를 채운다. 없는 값은 그대로 둔다(문구 빠짐을 시험에서 잡기 위해). */
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    // `Object.hasOwn`은 오래된 학교 기기(Safari 15.4·Chrome 93 미만)에 없다(G-24 HW-05)
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
  );
