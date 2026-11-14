import type { JSX } from 'react';
import { useInRouterContext, useNavigate } from 'react-router';
import { ExitPanel } from '../../ui/patterns/visitor/ExitPanel.tsx';
import { PATHS } from '../routes.ts';

export interface ExitSheetProps {
  readonly open: boolean;
  readonly seen: number;
  readonly reacted: number;
  /** `계속 둘러보기`·Esc */
  readonly onClose: () => void;
  /**
   * 나가기를 바꿀 때만(교사 미리 보기는 미리 보기 닫기, 개발 화면은 `/dev`). 없으면 학생 첫 화면 `/`(U-36).
   * 관람 화면은 이미 받는 `onHome`을 그대로 넘기면 된다.
   */
  readonly onLeave?: (() => void) | undefined;
  /** 재접속을 바꿀 때만(시험). 없으면 같은 주소로 페이지를 다시 연다 */
  readonly onRejoin?: (() => void) | undefined;
}

/**
 * 같은 전시 주소로 페이지를 다시 연다(U-37): 소켓·장면이 처음부터 새로 시작한다.
 * 별명·캐릭터는 기기에 남아 있어(`device.visitor(전시).nickname`·`prefs.character()`) 포스터에 그대로 채워진다.
 */
const reloadPage = (): void => window.location.reload();

/** 라우터 밖(개발 화면)에서 `onLeave` 없이 쓰일 때만: 주소를 바꿔 첫 화면으로 */
const leaveByLocation = (): void => window.location.assign(PATHS.home);

/**
 * 나가기 창 연결(PRD_V2 W-08, M1-5): `ExitPanel`에 이동·재접속을 붙인다.
 * 창 하나 규칙(다른 창을 닫고 연다)과 열 때(대문 3m 안 행동 단추)는 부르는 쪽(`VisitScreen`)이 정한다.
 */
export const ExitSheet = (p: ExitSheetProps): JSX.Element | null => {
  // `useNavigate`는 라우터 밖에서 던진다 — 개발 관람 화면(`/dev/visit`)은 라우터 없이 `VisitScreen`을 그린다
  const routed = useInRouterContext();
  return p.onLeave || !routed ? (
    <ExitSheetView {...p} leave={p.onLeave ?? leaveByLocation} />
  ) : (
    <RoutedExitSheet {...p} />
  );
};

const RoutedExitSheet = (p: ExitSheetProps): JSX.Element | null => {
  const navigate = useNavigate();
  // 학생 전시 화면의 `goHome`과 같은 이동(`navigate(PATHS.home)`)
  return <ExitSheetView {...p} leave={() => void navigate(PATHS.home)} />;
};

const ExitSheetView = ({
  open,
  seen,
  reacted,
  onClose,
  onRejoin,
  leave,
}: ExitSheetProps & { readonly leave: () => void }): JSX.Element | null => (
  <ExitPanel
    open={open}
    seen={seen}
    reacted={reacted}
    onLeave={leave}
    onRejoin={onRejoin ?? reloadPage}
    onStay={onClose}
  />
);
