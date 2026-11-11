import { copy } from '@gallery/core/copy';
import type { ErrorCode } from '@gallery/core/errors';
import type { ExhibitionView } from '@gallery/core/types';
import { type JSX, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ReactionSheet, type ReactionSheetIdentity } from '../../ui/patterns/visitor/ReactionSheet.tsx';
import { useServices } from '../services.ts';
import { ConsentPanel } from '../student/ConsentSheet.tsx';
import { consentAudience } from '../student/posterView.ts';
import { bodyOf, sheetFields } from './reactionModel.ts';
import { reactionRuntime } from './reactionRuntime.ts';
import { createReactionSheetStore } from './reactionSheetStore.ts';

export interface ReactionLayerProps {
  readonly view: ExhibitionView;
  /** 입장 코드(학생 경로) */
  readonly code: string;
  readonly artworkId: string;
  /** 닫기·남기기 성공 */
  readonly onClose: () => void;
  /** 반응 꺼짐·전시 닫힘·작품 없음을 알았을 때(선택) — 관람 화면이 버전 확인을 앞당기거나 단추를 숨긴다 */
  readonly onUnavailable?: ((code: ErrorCode) => void) | undefined;
}

/**
 * 반응 남기기 덮개(G-07, PLAN §7.3): 크게 보기 캡션의 `반응 남기기`가 연다. 동의(처음·별명 방식) → 반응 시트 → (반응 꺼짐·닫힘이면)
 * 문구 — 한 번에 하나만 보인다(덮개 칸 하나, §7.2). 작품이 바뀌면 `key={artworkId}`로 새로 연다.
 */
export const ReactionLayer = (p: ReactionLayerProps): JSX.Element => {
  const services = useServices();
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });
  const [store] = useState(() =>
    createReactionSheetStore({
      view: p.view,
      code: p.code,
      artworkId: p.artworkId,
      student: services.api.student,
      device: services.device,
      prefs: services.prefs,
      runtime: reactionRuntime(services),
      onClose: () => latest.current.onClose(),
      onUnavailable: code => latest.current.onUnavailable?.(code),
    }),
  );
  useEffect(() => store.getState().start(), [store]);
  const st = useStore(store);
  const settings = p.view.exhibition.reactions;
  const fields = sheetFields(p.view);

  if (st.step === 'consent')
    return (
      <ConsentPanel
        view={p.view}
        title={copy.consent.title}
        audience={consentAudience(settings, false)}
        nickname={st.consentNickname}
        consent={st.consent}
        onNicknameChange={st.setConsentNickname}
        onCheckedChange={st.setConsentChecked}
        onConfirm={() => void st.confirmConsent()}
        onBack={p.onClose}
        testId="reaction-consent"
      />
    );

  const identity: ReactionSheetIdentity =
    settings.naming === 'NICKNAME'
      ? { kind: 'nickname', nickname: st.nickname }
      : { kind: 'anonymous', audience: consentAudience(settings, false) };

  return (
    <ReactionSheet
      value={st.value}
      fields={fields}
      editing={st.editing}
      status={st.status}
      identity={identity}
      submitDisabled={bodyOf(st.value, fields) === null}
      artworkTitle={p.view.artworks.find(a => a.id === p.artworkId)?.title ?? null}
      nicknameEdit={st.nicknameEdit}
      memoError={st.memoError}
      formError={st.formError}
      notice={st.step === 'notice' ? st.notice : null}
      onChange={st.change}
      onSubmit={() => void st.submit()}
      onClose={p.onClose}
      onNicknameEdit={settings.naming === 'NICKNAME' ? st.startNicknameEdit : undefined}
      onNicknameDraft={st.setNicknameDraft}
      onNicknameSave={() => void st.saveNickname()}
      onNicknameCancel={st.cancelNicknameEdit}
    />
  );
};
