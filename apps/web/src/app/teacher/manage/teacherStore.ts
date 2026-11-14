import type {
  ArtworkTeacher,
  ExhibitionTeacher,
  RoomTeacher,
  TeacherExhibitionView,
} from '@gallery/core/types';
import { create } from 'zustand';

/**
 * 교사 관리 상태(PLAN §7.2 `teacherStore`): 전시·전시실·작품, 지금 전시실, 선택, 덮개 하나, 토스트.
 * 덮개(`overlay`)는 칸 하나라 작품 패널·전시실 시트·열기 시트가 동시에 열리지 않는다(PRD 9.6).
 * 올리기 진행은 `upload/uploadQueue.ts`가 따로 가진다(파일 객체를 상태에 넣지 않으려고).
 */

export type ManageOverlay =
  | { readonly kind: 'artwork'; readonly id: string }
  | { readonly kind: 'room'; readonly id: string }
  | { readonly kind: 'open' }
  | null;

export interface ManageToast {
  readonly id: number;
  readonly text: string;
  /** 되살리기 같은 한 가지 행동 */
  readonly action?: { readonly label: string; readonly run: () => void };
  /** 사라질 때까지(ms) */
  readonly ms: number;
}

/** 모드 탭(G-32): 작품 · 수업 · 반응 */
export type ManageTab = 'artworks' | 'class' | 'reactions';

export interface TeacherState {
  readonly view: TeacherExhibitionView | null;
  readonly roomId: string | null;
  readonly selected: readonly string[];
  readonly overlay: ManageOverlay;
  readonly toast: ManageToast | null;
  readonly tab: ManageTab;
  /** 점검 줄에서 눌러 깜빡일 카드 */
  readonly flashId: string | null;

  reset(): void;
  setView(view: TeacherExhibitionView): void;
  setExhibition(ex: ExhibitionTeacher): void;
  upsertRoom(room: RoomTeacher): void;
  removeRoom(roomId: string): void;
  setRooms(rooms: readonly RoomTeacher[]): void;
  upsertArtwork(art: ArtworkTeacher): void;
  /** 순서·전시실 바꾸기를 화면에 먼저(서버 답 전) */
  patchArtworks(patch: (arts: readonly ArtworkTeacher[]) => readonly ArtworkTeacher[]): void;
  setRoom(roomId: string | null): void;
  toggleSelect(id: string): void;
  clearSelection(): void;
  setOverlay(overlay: ManageOverlay): void;
  showToast(toast: Omit<ManageToast, 'id'>): void;
  hideToast(id?: number): void;
  setTab(tab: ManageTab): void;
  flash(id: string | null): void;
}

let toastSeq = 0;

const initial = {
  view: null,
  roomId: null,
  selected: [] as readonly string[],
  overlay: null,
  toast: null,
  tab: 'artworks' as ManageTab,
  flashId: null,
};

const byOrder = <T extends { order: number; id: string }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

const withView = (
  s: TeacherState,
  f: (v: TeacherExhibitionView) => TeacherExhibitionView,
): Partial<TeacherState> => (s.view ? { view: f(s.view) } : {});

export const useTeacherStore = create<TeacherState>()(set => ({
  ...initial,
  reset: () => set({ ...initial }),
  setView: view =>
    set(s => {
      const rooms = byOrder(view.rooms);
      const roomId = rooms.some(r => r.id === s.roomId) ? s.roomId : (rooms[0]?.id ?? null);
      const live = new Set(view.artworks.filter(a => a.deletedAt === null).map(a => a.id));
      return {
        view: { ...view, rooms },
        roomId,
        selected: s.selected.filter(id => live.has(id)),
      };
    }),
  setExhibition: ex => set(s => withView(s, v => ({ ...v, exhibition: ex }))),
  upsertRoom: room =>
    set(s =>
      withView(s, v => ({
        ...v,
        rooms: byOrder(
          v.rooms.some(r => r.id === room.id)
            ? v.rooms.map(r => (r.id === room.id ? room : r))
            : [...v.rooms, room],
        ),
      })),
    ),
  removeRoom: roomId =>
    set(s => {
      const next = withView(s, v => ({ ...v, rooms: v.rooms.filter(r => r.id !== roomId) }));
      return s.roomId === roomId ? { ...next, roomId: next.view?.rooms[0]?.id ?? null } : next;
    }),
  setRooms: rooms => set(s => withView(s, v => ({ ...v, rooms: byOrder(rooms) }))),
  upsertArtwork: art =>
    set(s =>
      withView(s, v => ({
        ...v,
        artworks: v.artworks.some(a => a.id === art.id)
          ? v.artworks.map(a => (a.id === art.id ? art : a))
          : [...v.artworks, art],
      })),
    ),
  patchArtworks: patch => set(s => withView(s, v => ({ ...v, artworks: [...patch(v.artworks)] }))),
  // 지금 전시실은 올릴 곳만 뜻한다(v3 보드는 모든 판을 그림) — 고른 것은 전시실에 묶이지 않는다(FIELD_PLAN HT-03a)
  setRoom: roomId => set({ roomId }),
  toggleSelect: id =>
    set(s => ({
      selected: s.selected.includes(id) ? s.selected.filter(x => x !== id) : [...s.selected, id],
    })),
  clearSelection: () => set({ selected: [] }),
  setOverlay: overlay => set({ overlay }),
  showToast: toast => set({ toast: { ...toast, id: ++toastSeq } }),
  hideToast: id => set(s => (id === undefined || s.toast?.id === id ? { toast: null } : {})),
  setTab: tab => set({ tab }),
  flash: flashId => set({ flashId }),
}));

/** 지금 전시실의 작품(지운 것 빼고, 순서대로) */
export const roomArtworks = (view: TeacherExhibitionView | null, roomId: string | null): ArtworkTeacher[] =>
  view ? byOrder(view.artworks.filter(a => a.roomId === roomId && a.deletedAt === null)) : [];

export const liveArtworks = (view: TeacherExhibitionView | null): ArtworkTeacher[] =>
  view ? view.artworks.filter(a => a.deletedAt === null) : [];

/** 배열 안에서 하나를 옮긴다(순서 바꾸기) */
export const moveItem = <T>(xs: readonly T[], from: number, to: number): T[] => {
  const out = [...xs];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item as T);
  return out;
};
