import type { ArtworkTeacher, ExhibitionTeacher } from '@gallery/core/types';

/**
 * 전시 관리 화면 안의 부품 약속(P5). 관리 화면(`ManageExhibition`, 격자·올리기·패널 — 서브에이전트 B)이 불러오고,
 * 아래 부품(열기 시트·`···` 메뉴·반응 탭 — 서브에이전트 A)은 이 속성만 받는다. 서버 호출은 각자 `useServices()`로.
 */
export interface OpenSheetProps {
  readonly exhibition: ExhibitionTeacher;
  /** 게시한 작품 수(0이면 열 수 없음 문구) */
  readonly publishedCount: number;
  /** 열기·닫기 등으로 전시 행이 바뀜(관리 화면이 rev·상태를 새로) */
  readonly onChanged: (next: ExhibitionTeacher) => void;
  readonly onClose: () => void;
}

export interface ManageMenuProps {
  readonly exhibition: ExhibitionTeacher;
  readonly onChanged: (next: ExhibitionTeacher) => void;
  /** 지금 삭제 끝(관리 화면이 첫 화면으로) */
  readonly onDeleted: () => void;
  /** `전시 열기` 시트를 열어 달라(열린 뒤 QR·주소 다시 보기) */
  readonly onOpenSheet: () => void;
}

export interface ReactionsTabProps {
  readonly exhibitionId: string;
  readonly artworks: readonly ArtworkTeacher[];
}
