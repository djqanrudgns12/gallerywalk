import {
  ReactionSettingsSchema,
  type TeacherExhibitionView,
  TeacherExhibitionViewSchema,
} from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { testExhibitionView, uuid } from '../../../dev/testView.ts';
import { previewViewOf } from './previewView.ts';

const teacherOf = (showSchool: boolean): TeacherExhibitionView => {
  const v = testExhibitionView([3]);
  const extra = {
    status: 'PUBLISHED',
    formAuto: 'LANDSCAPE',
    formOverride: null,
    textHeavyAuto: false,
    textHeavyOverride: null,
    warnings: [],
    failCode: null,
    rev: 1,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  } as const;
  const hidden = { ...v.artworks[0]!, id: uuid(0xabc), ...extra, status: 'HIDDEN' as const };
  return TeacherExhibitionViewSchema.parse({
    exhibition: {
      id: v.exhibition.id,
      entryCode: '123456',
      title: v.exhibition.title,
      subtitle: null,
      templateId: 'modern-history',
      poster: null,
      schoolName: '가상초',
      className: '5-1',
      showSchool,
      settings: {
        reactions: ReactionSettingsSchema.parse({}),
        tour: { timeMode: 'MUSIC', secondsPerRoom: 40 },
      },
      status: 'OPEN',
      rev: 3,
      createdAt: 1,
      expiresAt: v.exhibition.expiresAt,
      openedAt: 2,
      closedAt: null,
    },
    rooms: v.rooms.map(r => ({ ...r, rev: 1 })),
    artworks: [...v.artworks.map(a => ({ ...a, ...extra, form: a.form, formAuto: a.form })), hidden],
    layout: v.layout,
    versions: v.versions,
  });
};

describe('교사 묶음 → 관람 장면 입력', () => {
  it('벽에 걸린(게시한) 작품만, 교사 전용 칸은 버리고, 학교·학급은 표시를 켰을 때만', () => {
    const t = teacherOf(false);
    const v = previewViewOf(t)!;
    expect(v.artworks.map(a => a.id).sort()).toEqual(t.layout!.frames.map(f => f.artworkId).sort());
    expect(v.artworks.some(a => a.id === uuid(0xabc))).toBe(false);
    expect(Object.keys(v.artworks[0]!)).not.toContain('rev');
    expect(v.exhibition.school).toBeNull();
    expect(previewViewOf(teacherOf(true))!.exhibition.school).toEqual({
      schoolName: '가상초',
      className: '5-1',
    });
    expect(v.reactions).toEqual([]);
  });

  it('배치가 없으면(게시 0) null', () => {
    expect(previewViewOf({ ...teacherOf(false), layout: null })).toBeNull();
  });
});
