import type { ArtworkPublic, ExhibitionView, TeacherExhibitionView } from '@gallery/core/types';

/**
 * 교사 보기 묶음 → 학생 보기 묶음 모양(자동 투어·3D 미리 보기, P5-6·P5-9). 같은 관람 장면을 그대로 쓰려고.
 * - 게시한 작품만(배치가 게시 작품으로 만들어지므로 배치에 있는 것만 남긴다)
 * - 교사 전용 칸(상태·경고·rev 등)은 버린다 · 학교·학급은 "표시"를 켰을 때만
 * - 공개 반응 집계는 없음(교사 반응 탭이 따로 본다)
 * 배치가 없으면(게시 0) null.
 */
export const previewViewOf = (t: TeacherExhibitionView): ExhibitionView | null => {
  if (!t.layout) return null;
  const onWall = new Set(t.layout.frames.map(f => f.artworkId));
  const ex = t.exhibition;
  const artworks: ArtworkPublic[] = t.artworks
    .filter(a => onWall.has(a.id))
    .map(a => ({
      id: a.id,
      roomId: a.roomId,
      order: a.order,
      title: a.title,
      author: a.author,
      caption: a.caption,
      description: a.description,
      kind: a.kind,
      form: a.form,
      textHeavy: a.textHeavy,
      featured: a.featured,
      pageMode: a.pageMode,
      image: a.image,
      pages: a.pages,
      audio: a.audio,
      textBody: a.textBody,
    }));
  return {
    exhibition: {
      id: ex.id,
      title: ex.title,
      subtitle: ex.subtitle,
      templateId: ex.templateId,
      poster: ex.poster,
      school: ex.showSchool ? { schoolName: ex.schoolName, className: ex.className } : null,
      expiresAt: ex.expiresAt,
      reactions: ex.settings.reactions,
    },
    rooms: t.rooms.map(r => ({ id: r.id, order: r.order, title: r.title, intro: r.intro, bgm: r.bgm })),
    artworks,
    layout: t.layout,
    versions: t.versions,
    reactions: [],
  };
};
