import { computeLayout } from '@gallery/core/layout';
import { ReactionSettingsSchema, type ExhibitionView } from '@gallery/core/types';
import type { ExhibitionRecord, ExhibitionStore } from './store.ts';
import type { CacheBackend } from './runtime.ts';

export const EX = '00000000-0000-4000-8000-000000000001';
export const ROOM = '00000000-0000-4000-8000-000000000002';
export const ART = '00000000-0000-4000-8000-000000000003';
export const ORIGIN = 'https://gallery.test';
export const mediaUrl = `${ORIGIN}/assets/g/m/${EX}/${ART}/audio.m4a`;

export const view = (expiresAt = 10_000): ExhibitionView => ({
  exhibition: {
    id: EX,
    title: '가상 전시',
    subtitle: null,
    templateId: 'modern-history',
    poster: null,
    school: null,
    expiresAt,
    reactions: ReactionSettingsSchema.parse({}),
  },
  rooms: [{ id: ROOM, order: 0, title: '가상 전시실', intro: null, bgm: null }],
  artworks: [],
  layout: computeLayout({
    exhibitionId: EX,
    templateId: 'modern-history',
    algoVersion: 1,
    rooms: [{ id: ROOM, order: 0, hasBgm: false }],
    artworks: [],
  }),
  versions: { layoutVersion: 1, contentVersion: 1, settingsVersion: 1 },
  reactions: [],
});

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
export const ok = (expiresAt = 10_000): Response => json({ data: view(expiresAt), requestId: 'test' });

/** Cache API와 달리 객체를 그대로 돌려주지 않도록, 읽기·쓰기마다 본문을 복제한다. */
export const fakeCaches = (): CacheBackend => {
  const caches = new Map<string, Map<string, Response>>();
  return {
    keys: async () => [...caches.keys()],
    delete: async name => caches.delete(name),
    open: async name => {
      let data = caches.get(name);
      if (!data) {
        data = new Map();
        caches.set(name, data);
      }
      const entries = data;
      return {
        match: async req => entries.get(req.url)?.clone(),
        put: async (req, res) => {
          entries.set(req.url, res.clone());
        },
        delete: async req => entries.delete(req.url),
      };
    },
  };
};

export const fakeStore = (): ExhibitionStore => {
  const records = new Map<string, ExhibitionRecord>();
  return {
    list: async () => [...records.values()].map(r => ({ ...r, codes: [...r.codes] })),
    put: async record => {
      records.set(record.exhibitionId, { ...record, codes: [...record.codes] });
    },
    delete: async id => {
      records.delete(id);
    },
  };
};
