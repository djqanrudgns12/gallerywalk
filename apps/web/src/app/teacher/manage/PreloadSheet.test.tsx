import { copy, fill } from '@gallery/core/copy';
import type { ExhibitionView, TeacherExhibitionView } from '@gallery/core/types';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import type {
  MediaCache,
  PreloadOptions,
  PreloadProgress,
  PreloadResult,
} from '../../../ports/mediaCache.ts';
import { deferred } from '../../../dev/studentFixtures.ts';
import { teacherArtwork, teacherExhibition, teacherRoom } from '../../../dev/teacherFixtures.ts';
import { fakeTeacher, mountTeacher, teacherServices } from '../../../dev/teacherShellFixtures.tsx';
import { testExhibitionView, testRoomId, uuid } from '../../../dev/testView.ts';
import { click, flush } from '../../student/testDom.tsx';
import { ManageMenu } from './ManageMenu.tsx';
import { formatMb, PreloadSheet } from './PreloadSheet.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

/** 교사 보기: 1관 그림 3(배경음악 있음) · 2관 그림 1 · 숨긴 작품 1(배치 밖), 배치는 실제 배치 엔진 */
const teacherViewWithLayout = (): TeacherExhibitionView => {
  const v = testExhibitionView([3, 1]);
  return {
    exhibition: teacherExhibition({ status: 'OPEN' }),
    rooms: [
      teacherRoom(0, {
        bgm: {
          asset: {
            assetId: uuid(0xe001),
            variants: [{ name: 'audio', ext: 'm4a', w: 0, h: 0, bytes: 3_000_000 }],
          },
          durationMs: 150_000,
          analysis: { audibleStartMs: 0, audibleEndMs: 150_000, loudnessDb: -16 },
        },
      }),
      teacherRoom(1),
    ],
    artworks: [
      teacherArtwork(0, 0),
      teacherArtwork(0, 1),
      teacherArtwork(0, 2),
      teacherArtwork(1, 0),
      teacherArtwork(1, 1, { status: 'HIDDEN' }),
    ],
    layout: v.layout,
    versions: v.versions,
  };
};

type PreloadCall = {
  readonly view: ExhibitionView;
  readonly onProgress: (p: PreloadProgress) => void;
  readonly options: PreloadOptions | undefined;
  readonly done: ReturnType<typeof deferred<PreloadResult>>;
};

/** 부를 때마다 끝을 시험이 정하는 가짜 기기 캐시 */
const fakeMedia = () => {
  const calls: PreloadCall[] = [];
  const media: MediaCache = {
    register: async () => true,
    appStarted: async () => {},
    screenResumed: async () => {},
    space: async () => ({ availableBytes: null, sufficient: null }),
    preload: vi.fn((view, onProgress, options) => {
      const done = deferred<PreloadResult>();
      calls.push({ view, onProgress, options, done });
      return done.promise;
    }),
  };
  return { media, calls };
};

const mountSheet = (teacher: TeacherApi, media: MediaCache | undefined) => {
  const t = teacherServices(teacher);
  const onClose = vi.fn();
  mounted = mountTeacher(<PreloadSheet exhibitionId={teacherExhibition().id} onClose={onClose} />, {
    ...t.services,
    media,
  });
  return { onClose };
};

const q = (id: string) => mounted?.q(`[data-testid="${id}"]`) ?? null;
const p = copy.teacher.preload;

describe('수업 전 미리 불러오기 시트(P5-10)', () => {
  it('`···` 메뉴에서 열면 메뉴는 닫히고 시트 하나만 열린다', async () => {
    const tv = teacherViewWithLayout();
    const { media } = fakeMedia();
    const t = teacherServices(fakeTeacher({ exhibition: vi.fn(async () => tv) }));
    mounted = mountTeacher(
      <ManageMenu
        exhibition={tv.exhibition}
        onChanged={() => {}}
        onDeleted={() => {}}
        onOpenSheet={() => {}}
      />,
      { ...t.services, media },
    );
    click(q('manage-menu-trigger'));
    click(q('menu-preload'));
    await flush();
    expect(q('preload-sheet')).not.toBeNull();
    expect(q('manage-menu')).toBeNull();
    expect(media.preload).toHaveBeenCalledTimes(1);
    click(mounted.q('[data-testid="preload-sheet"] button[aria-label]'));
    expect(q('preload-sheet')).toBeNull();
  });

  it('게시 작품 전체·배경음악을 WHOLE로 받고, 진행률·저장한 MB·다 받음을 보인다', async () => {
    const tv = teacherViewWithLayout();
    const exhibition = vi.fn(async () => tv);
    const { media, calls } = fakeMedia();
    mountSheet(fakeTeacher({ exhibition }), media);
    await flush();
    expect(exhibition).toHaveBeenCalledWith(tv.exhibition.id, expect.anything());
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.options).toEqual({ scope: 'WHOLE' });
    // 숨긴 작품은 빠지고 게시 작품 4개 전부, 1관 배경음악이 함께 넘어간다
    expect(call.view.artworks.map(a => a.id).sort()).toEqual(
      tv.artworks
        .filter(a => a.status === 'PUBLISHED')
        .map(a => a.id)
        .sort(),
    );
    expect(call.view.rooms.find(r => r.id === testRoomId(0))?.bgm?.asset.assetId).toBe(uuid(0xe001));

    await act(async () => {
      call.onProgress({ kind: 'LOADING', completed: 3, total: 10, bytes: 2_500_000 });
    });
    expect(q('preload-progress')?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '30',
    );
    expect(q('preload-saved')?.textContent).toBe(fill(p.saved, { mb: '2.5' }));
    expect(q('preload-count')?.textContent).toBe(fill(p.count, { done: 3, total: 10 }));
    expect(mounted?.container.ownerDocument.body.textContent).toContain(p.keepGoing);

    await act(async () => {
      call.onProgress({ kind: 'READY', completed: 10, total: 10, bytes: 12_345_678 });
    });
    call.done.resolve({ kind: 'READY' });
    await flush();
    expect(q('preload-ready')?.textContent).toBe(fill(p.ready, { mb: '12.3' }));
    expect(q('preload-retry')).toBeNull();
  });

  it('공간이 모자라면 그 문구와 다시 받기, 다시 받기는 처음부터 다시 부른다', async () => {
    const tv = teacherViewWithLayout();
    const { media, calls } = fakeMedia();
    mountSheet(fakeTeacher({ exhibition: vi.fn(async () => tv) }), media);
    await flush();
    await act(async () => {
      calls[0]!.onProgress({ kind: 'NO_SPACE', completed: 0, total: 10, bytes: 0 });
    });
    calls[0]!.done.resolve({ kind: 'NO_SPACE' });
    await flush();
    expect(q('preload-no-space')?.textContent).toBe(p.noSpace);
    expect(q('preload-ready')).toBeNull();
    click(q('preload-retry'));
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('진행 알림 없이 실패로 끝나도 실패 문구를 보인다', async () => {
    const tv = teacherViewWithLayout();
    const { media, calls } = fakeMedia();
    mountSheet(fakeTeacher({ exhibition: vi.fn(async () => tv) }), media);
    await flush();
    calls[0]!.done.resolve({ kind: 'FAILED' });
    await flush();
    expect(q('preload-failed')?.textContent).toBe(p.failed);
    expect(q('preload-retry')).not.toBeNull();
  });

  it('게시 작품이 없으면(배치 없음) 받지 않고 안내만', async () => {
    const tv = { ...teacherViewWithLayout(), layout: null };
    const { media } = fakeMedia();
    mountSheet(fakeTeacher({ exhibition: vi.fn(async () => tv) }), media);
    await flush();
    expect(q('preload-empty')?.textContent).toBe(p.empty);
    expect(media.preload).not.toHaveBeenCalled();
  });

  it('기기 캐시가 없으면(개발·시험) 쓸 수 없다고 알린다', async () => {
    const exhibition = vi.fn(async () => teacherViewWithLayout());
    mountSheet(fakeTeacher({ exhibition }), undefined);
    await flush();
    expect(q('preload-unavailable')?.textContent).toBe(p.unavailable);
    expect(exhibition).not.toHaveBeenCalled();
  });

  it('MB는 1,000,000바이트 단위로 소수 한 자리', () => {
    expect(formatMb(0)).toBe('0.0');
    expect(formatMb(12_345_678)).toBe('12.3');
    expect(formatMb(-1)).toBe('0.0');
  });
});
