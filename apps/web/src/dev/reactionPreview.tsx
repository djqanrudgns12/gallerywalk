import { type CSSProperties, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type NicknameEditState,
  PublicReactions,
  ReactionSheet,
  type ReactionSheetFields,
  type ReactionSheetIdentity,
  type ReactionSheetStatus,
  type ReactionSheetValue,
  ZoomCaption,
} from '../ui/patterns/visitor/index.ts';
import '../ui/tokens.css';
import '../ui/themes/modern-history.css';

/**
 * 반응 부품 캡처용 개발 화면(P4-6) — 운영 화면은 가져오지 않는다. scratchpad의 Playwright 스크립트가 개발 웹(4522)에서
 * 이 모듈을 불러 `mountReactionPreview(장면)`으로 부품만 띄운다. 합성 작품·가상 별명·가상 메모만 쓴다(AGENTS.md §2).
 */

export type PreviewScene = 'sheet' | 'score-queued' | 'anonymous-blocked' | 'nickname-edit' | 'public';

interface SheetScene {
  readonly value: ReactionSheetValue;
  readonly fields: ReactionSheetFields;
  readonly editing: boolean;
  readonly status: ReactionSheetStatus;
  readonly identity: ReactionSheetIdentity;
  readonly memoError?: string;
  readonly nicknameEdit?: NicknameEditState;
}

const BASIC: ReactionSheetFields = { sticker: true, memo: true, score: false };

const SHEETS: Record<Exclude<PreviewScene, 'public'>, SheetScene> = {
  sheet: {
    value: {
      sticker: 'LEARNED',
      memo: '편지에 날짜가 두 번 적혀 있어요',
      scoreFact: null,
      scoreDelivery: null,
    },
    fields: BASIC,
    editing: false,
    status: 'idle',
    identity: { kind: 'nickname', nickname: '하늘고래' },
  },
  'score-queued': {
    value: { sticker: 'GREAT', memo: '지도 그림이 또렷해요', scoreFact: 3, scoreDelivery: 2 },
    fields: { sticker: true, memo: true, score: true },
    editing: true,
    status: 'queued',
    identity: { kind: 'nickname', nickname: '하늘고래' },
  },
  'anonymous-blocked': {
    value: { sticker: null, memo: '가상의 걸러진 메모', scoreFact: null, scoreDelivery: null },
    fields: BASIC,
    editing: false,
    status: 'idle',
    identity: { kind: 'anonymous', audience: 'teacher' },
    memoError: '다른 말로 적어 볼까요?',
  },
  'nickname-edit': {
    value: { sticker: 'MOVED', memo: '', scoreFact: null, scoreDelivery: null },
    fields: BASIC,
    editing: true,
    status: 'sent',
    identity: { kind: 'nickname', nickname: '하늘고래' },
    nicknameEdit: { value: '바다고래', busy: false, error: null },
  },
};

const stage: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 'var(--s-3)',
  padding: 'var(--s-6) var(--s-4)',
  boxSizing: 'border-box',
  background: 'var(--surface-wall)',
  fontFamily: 'var(--font-ui)',
};

/** 크게 보기 중인 작품 자리(합성 액자) */
const frame: CSSProperties = {
  width: 'min(72vw, 520px)',
  aspectRatio: '3 / 2',
  background: 'var(--surface-oak)',
  border: '10px solid var(--frame-outer)',
  boxShadow: 'var(--shadow-frame)',
  flexShrink: 0,
};

const Sheet = ({ scene }: { readonly scene: SheetScene }) => {
  const [value, setValue] = useState(scene.value);
  return (
    <ReactionSheet
      value={value}
      fields={scene.fields}
      editing={scene.editing}
      status={scene.status}
      identity={scene.identity}
      submitDisabled={false}
      artworkTitle="가상의 편지"
      memoError={scene.memoError ?? null}
      nicknameEdit={scene.nicknameEdit ?? null}
      onChange={setValue}
      onSubmit={() => undefined}
      onClose={() => undefined}
      onNicknameEdit={() => undefined}
      onNicknameDraft={() => undefined}
      onNicknameSave={() => undefined}
      onNicknameCancel={() => undefined}
    />
  );
};

const Preview = ({ scene }: { readonly scene: PreviewScene }) => (
  <div data-theme="modern-history" style={stage}>
    <div style={frame} aria-hidden="true" />
    {scene === 'public' ? (
      <>
        <ZoomCaption
          title="가상의 편지"
          author="가상 작가 1"
          caption="합성 자료로 만든 시험 작품이에요"
          onClose={() => undefined}
          onReact={() => undefined}
        />
        <PublicReactions
          stickers={{ MOVED: 4, LEARNED: 7, GREAT: 0, CURIOUS: 2 }}
          score={{ factAvg: 7 / 3, deliveryAvg: 2.75 }}
          memos={Array.from({ length: 7 }, (_, i) => ({
            nickname: i % 3 === 0 ? null : `가상 별명 ${i}`,
            memo: `가상의 고른 메모 ${i + 1}`,
          }))}
        />
      </>
    ) : (
      <Sheet scene={SHEETS[scene]} />
    )}
  </div>
);

/** Playwright가 부른다: 문서 몸을 비우고 그 장면만 띄운다 */
export const mountReactionPreview = (scene: PreviewScene): void => {
  document.body.replaceChildren();
  document.body.style.margin = '0';
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(<Preview scene={scene} />);
};
