import type { CharacterId, ExhibitionView } from '@gallery/core/types';

/**
 * 학생 관람 화면(P4-2, Claude)과 학생 경로·포스터(P4-1)가 만나는 약속.
 * 포스터가 떠 있는 동안에도 관람 화면을 뒤에 미리 띄워 첫 자리(광장)를 준비한다(PLAN §7.3 — 첫 방 준비 전에는
 * 입장 버튼이 "준비하고 있어요"로 잠김). `entered`가 false인 동안은 입력·소리·함께 관람을 하지 않는다.
 */
export interface VisitProgress {
  /** 첫 자리를 그릴 준비가 끝남(외관 조각·내 캐릭터) */
  readonly ready: boolean;
  /** 0~1 */
  readonly progress: number;
  /**
   * 받을 파일은 다 받았고 그래픽 준비(셰이더·첫 그리기)만 남음. 이때는 준비 시간 상한(`VISIT_READY_TIMEOUT_MS`)으로
   * 가벼운 화면으로 보내지 않는다 — 상한은 학교망에서 받기가 멈춘 경우를 위한 것이다(G-24).
   */
  readonly preparing?: boolean | undefined;
}

/** 2D로 바꾼 까닭: WebGL2 없음 · 컨텍스트 손실 거듭 · '낮음'에서도 느림 · 3D 공간 파일을 하나도 받지 못함(G-24) */
export type Fallback2dReason = 'webgl' | 'context' | 'fps' | 'load';

export interface VisitScreenProps {
  /** `GET /api/e/{code}` 응답(OPEN 전시) */
  readonly view: ExhibitionView;
  /** 입장 코드(함께 관람 주소용) */
  readonly code: string;
  /** 포스터에서 고른 학생 캐릭터 */
  readonly character: CharacterId;
  /** 함께 관람 첫 메시지에 실을 이 기기 방문자 토큰 원문. null이면 혼자 관람 */
  readonly liveToken: string | null;
  /** 함께 관람 역할(기본 방문자). 교사 3D 미리 보기는 `teacher`(토큰 = 교사 세션 토큰, PRD 15.8) */
  readonly liveAs?: 'visitor' | 'teacher' | undefined;
  /** false = 포스터 뒤에서 미리 준비, true = 관람 중 */
  readonly entered: boolean;
  readonly onProgress?: ((p: VisitProgress) => void) | undefined;
  /** 출구·메뉴의 `처음으로` */
  readonly onHome: () => void;
  /**
   * 2D 대체 화면으로 바꿀 때(ADR-019, §6.12): WebGL2를 못 만듦 · 60초 안 컨텍스트 손실 두 번 · '낮음'에서도 계속 느림 ·
   * 3D 공간 파일을 하나도 받지 못함(G-24 HW-01).
   * 한 번만 부른다. 그 전시 동안 2D로 남는다(다음 방문에 3D를 다시 시도).
   */
  readonly onFallback2d?: ((reason: Fallback2dReason) => void) | undefined;
  /** `소리` 켬/끔(기기에 기억 — `DeviceStore.soundOn`). 없으면 이 화면 안에서만(켬으로 시작) */
  readonly sound?: { readonly on: boolean; readonly set: (on: boolean) => void } | undefined;
  /** 띠 "전시가 새로 바뀌었어요 `새로 보기`"(P4-9 — 지금 보던 관이 바뀌어 적용을 미룬 새 보기 묶음이 있음) */
  readonly pendingUpdate?: boolean | undefined;
  readonly onApplyUpdate?: (() => void) | undefined;
  /**
   * 교사 3D 미리 보기(P5-6, PRD G-13): 3D에서 작품을 누르면 걸어가 크게 보는 대신 이것을 부른다(그 작품 관리 패널).
   * 있으면 학생 일(반응 남기기·보내기 줄)을 하지 않는다.
   */
  readonly onPickArtwork?: ((artworkId: string) => void) | undefined;
}
