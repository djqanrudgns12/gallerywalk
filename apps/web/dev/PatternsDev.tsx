import { copy } from '@gallery/core/copy';
import { type CSSProperties, type JSX, useState } from 'react';
import {
  type ArtworkCardProps,
  ArtworkGrid,
  EntryPoster,
  Icon,
  type IconName,
  Joystick,
  LoadingMuseum,
  NearArtworkCard,
  type StickValue,
  type StudentCharacterId,
  TeacherCharacterDialog,
  type TeacherCharacterId,
  TopBar,
  WalkHint,
  WalkNav,
  ZoomCaption,
} from '../src/ui/index.ts';
import '../src/ui/tokens.css';
import '../src/ui/themes/modern-history.css';
import '../src/ui/themes/curator.css';

const ALL_ICONS: readonly IconName[] = [
  'chevron-left',
  'chevron-right',
  'map',
  'sound-on',
  'sound-off',
  'menu',
  'zoom-in',
  'close',
  'user',
  'plus',
  'grid',
  'warning',
  'play',
];

const TEACHER_ITEMS: readonly ArtworkCardProps[] = [
  {
    id: 'art-1',
    title: '하늘고래의 호외',
    author: '하늘고래',
    form: 'LANDSCAPE',
    pageCount: 3,
    status: 'PUBLISHED',
    featured: true,
    selected: true,
    formLabel: '가로',
    pageLabel: '3쪽',
    statusLabel: '게시',
  },
  {
    id: 'art-2',
    title: '산골 의병장의 편지',
    author: '소나무',
    form: 'PORTRAIT',
    pageCount: 1,
    status: 'PUBLISHED',
    dragging: true,
    formLabel: '세로',
    pageLabel: '1쪽',
    statusLabel: '게시',
    draggingLabel: '순서 이동 중',
  },
  {
    id: 'art-3',
    title: '독립문과 태극기 목판화',
    author: '별바라기',
    form: 'SQUARE',
    pageCount: 1,
    status: 'PUBLISHED',
    darkMat: true,
    warnings: ['LOW_RES'],
    formLabel: '정사각',
    pageLabel: '1쪽',
    statusLabel: '게시',
    warningLabel: '조금 흐려요',
  },
  {
    id: 'art-4',
    title: '만주 벌판 독립군 행군도',
    author: '푸른솔',
    form: 'PANORAMA',
    pageCount: 2,
    status: 'PUBLISHED',
    formLabel: '파노라마',
    pageLabel: '2쪽 나눔',
    statusLabel: '게시',
  },
  {
    id: 'art-5',
    title: '그날의 만세 소리 웹툰',
    author: '봄바람',
    form: 'TALL',
    pageCount: 4,
    status: 'PROCESSING',
    formLabel: '긴 세로',
    pageLabel: '4쪽 나눔',
    statusLabel: '처리 중',
  },
  {
    id: 'art-6',
    title: '무명 의병을 기리는 시',
    author: '은하수',
    form: 'TEXTCARD',
    pageCount: 2,
    status: 'HIDDEN',
    formLabel: '글 카드',
    pageLabel: '2쪽',
    statusLabel: '숨김',
  },
  {
    id: 'art-7',
    title: '청산리의 아침 합창곡',
    author: '아리랑모둠',
    form: 'SOUND',
    pageCount: 1,
    status: 'FAILED',
    failCode: 'E_FILE_BROKEN',
    durationLabel: '02:15',
    formLabel: '소리 명판',
    pageLabel: '1쪽',
    statusLabel: '실패',
    warningLabel: '파일 확인',
  },
];

const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--loader-bg)',
  color: 'var(--plate-ink)',
  fontFamily: 'var(--font-ui)',
  padding: 'var(--s-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s-6)',
};

const sectionStyle: CSSProperties = {
  backgroundColor: 'var(--surface-wall)',
  border: '1px solid var(--plate-edge)',
  borderRadius: 'var(--r-card)',
  padding: 'var(--s-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s-4)',
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-5)',
  fontWeight: 700,
  margin: 0,
  color: 'var(--plate-ink)',
  borderBottom: '1px solid var(--plate-edge)',
  paddingBottom: 'var(--s-2)',
};

export const PatternsDev = (): JSX.Element => {
  const [stopIdx, setStopIdx] = useState(3);
  const [soundOn, setSoundOn] = useState(true);
  const [stick, setStick] = useState<StickValue>({ forward: 0, strafe: 0, run: false });
  const [nickname, setNickname] = useState('하늘고래');
  const [studentChar, setStudentChar] = useState<StudentCharacterId>('student-m');
  const [teacherChar, setTeacherChar] = useState<TeacherCharacterId>('teacher-f');
  const [teacherName, setTeacherName] = useState('김서연 선생님');
  const [selectedCardId, setSelectedCardId] = useState('art-1');

  const items = TEACHER_ITEMS.map(item => ({
    ...item,
    selected: item.id === selectedCardId,
  }));

  return (
    <main style={pageStyle} data-theme="modern-history" data-testid="patterns-dev">
      {/* 1. 관람 상단·하단 HUD 및 조이스틱·근접 카드·줌 캡션 */}
      <section style={sectionStyle} aria-label="관람 화면 부품">
        <h2 style={sectionTitleStyle}>1. 관람 화면 부품 (Visitor HUD · ZoomCaption · Icons)</h2>

        <TopBar
          title="S.O.S. 연대기 전시관"
          place="제1관 · 1905 을사늑약과 의병"
          liveCount={14}
          onCollection={() => {}}
        />

        <TopBar title="S.O.S. 연대기 전시관" place="전시관 앞" liveCount={0} />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 'var(--s-4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <Joystick onChange={setStick} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
              <WalkHint touch={true} />
              <WalkHint touch={false} />
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--plate-ink-sub)' }}>
                {`stick: forward=${stick.forward.toFixed(2)}, strafe=${stick.strafe.toFixed(2)}, run=${String(stick.run)}`}
              </span>
            </div>
          </div>

          <NearArtworkCard
            title="하늘고래의 호외"
            author="하늘고래"
            caption="을사늑약 소식을 전하는 신문 기사 — 거리로 나선 사람들의 목소리"
            featured={true}
            stopLabel="제1관 · 3/6"
            onZoom={() => {}}
          />

          <WalkNav
            current={stopIdx}
            total={6}
            onPrev={() => setStopIdx(i => Math.max(1, i - 1))}
            onNext={() => setStopIdx(i => Math.min(6, i + 1))}
            onMap={() => {}}
            onSoundToggle={() => setSoundOn(v => !v)}
            soundOn={soundOn}
            onMenu={() => {}}
          />
        </div>

        <ZoomCaption
          title="하늘고래의 호외"
          author="하늘고래 (5학년 2반)"
          caption="가로 · 글이 많은 작품 (자동 3쪽 나눔)"
          description="1905년 을사늑약 소식을 전하는 당시 신문 사설과 의병 격문을 조사해 직접 호외 신문으로 편집했습니다. 첫째 쪽에는 조약의 부당함을 알리는 사설을, 둘째 쪽에는 전국 각지에서 일어난 의병과 시민들의 목소리를 담았습니다."
          featured={true}
          pageInfo={{ page: 2, total: 3 }}
          defaultExpanded={true}
          onClose={() => {}}
          onReact={() => {}}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--s-2)',
            padding: 'var(--s-3)',
            backgroundColor: 'var(--plate-bg)',
            border: '1px solid var(--plate-edge)',
            borderRadius: 'var(--r-plate)',
          }}
        >
          {ALL_ICONS.map(name => (
            <span
              key={name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                border: '1px solid var(--plate-edge)',
                borderRadius: 'var(--r-plate)',
                fontSize: 'var(--fs-1)',
              }}
            >
              <Icon name={name} size={18} />
              <span>{name}</span>
            </span>
          ))}
        </div>
      </section>

      {/* 2. 입장 포스터 + 로딩 */}
      <section style={sectionStyle} aria-label="입장 및 로딩 부품">
        <h2 style={sectionTitleStyle}>2. 입장 포스터 및 미술관 외관 로딩 (EntryPoster · LoadingMuseum)</h2>

        <EntryPoster
          title="S.O.S. 연대기"
          subtitle="1905년 을사늑약부터 1920년 청산리 전투까지, 그날의 신문 호외와 시·웹툰·노래로 기록한 우리들의 역사 전시관입니다."
          schoolSummary="서울하늘초등학교 5학년 2반"
          openUntil="2026. 12. 11."
          artworkCount={21}
          togetherCount={14}
          nickname={nickname}
          onNicknameChange={setNickname}
          character={studentChar}
          onCharacterChange={setStudentChar}
          onEnter={() => {}}
          showInAppBrowserHint={true}
        />

        <LoadingMuseum title="S.O.S. 연대기" progress={72} />
      </section>

      {/* 3. 교사 작품 관리 격자 (7종 액자 미리 보기) + 교사 캐릭터 대화창 */}
      <section style={sectionStyle} data-theme="curator" aria-label="교사 화면 부품">
        <h2 style={sectionTitleStyle}>3. 교사 준비실 부품 (ArtworkGrid 7종 · TeacherCharacterDialog)</h2>

        <ArtworkGrid
          items={items}
          onSelectCard={setSelectedCardId}
          onAddMore={() => {}}
          addTitle="작품 더 올리기"
          addSubtitle="그림·PDF·소리를 놓거나 글을 붙여넣어요"
        />

        <TeacherCharacterDialog
          open={true}
          character={teacherChar}
          onCharacterChange={setTeacherChar}
          displayName={teacherName}
          onDisplayNameChange={setTeacherName}
          onSave={() => {}}
          onClose={() => {}}
          title="선생님 캐릭터 고르기"
          subtitle="학생들과 함께 전시관을 걸을 때 보이는 선생님 모습과 머리 위 이름표예요"
          maleLabel={`${copy.live.teacher} A`}
          femaleLabel={`${copy.live.teacher} B`}
          nameplateLabel="전시관 이름표"
          nameplateHint="학생들에게 선생님 배지와 함께 보여요"
          saveLabel="이 캐릭터로 저장하기"
        />
      </section>
    </main>
  );
};
