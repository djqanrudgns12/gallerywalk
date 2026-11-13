import { copy, fill } from '@gallery/core/copy';
import type { ExhibitionView } from '@gallery/core/types';
import {
  type JSX,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import '../../ui/tokens.css';
import '../../ui/themes/modern-history.css';
import '../../ui/themes/gallery-dark.css';
import type { Track } from '../../audio/AudioEngine.ts';
import { Icon } from '../../ui/Icon.tsx';
import { ZoomCaption } from '../../ui/patterns/visitor/ZoomCaption.tsx';
import type { ViewerArtwork } from '../../viewer/scene/types.ts';
import type { CardText } from '../../viewer/textures/textCard.ts';
import {
  PublicReactionsFor,
  ReactionLayer,
  reactionsEnabled,
  useReactionPending,
} from '../reactions/index.ts';
import { ServicesContext } from '../services.ts';
import { audioEngine, useRoomMusic } from '../visit/roomMusic.ts';
import { visitModelOf } from '../visit/visitModel.ts';
import {
  EXIT_STOP_ID,
  fitFrame,
  resumeSlide,
  type Slide2D,
  type SlideTarget,
  slidesOf,
  step2d,
  swipeDir,
} from './slides.ts';
import { TextCard2D } from './TextCard2D.tsx';
import s from './Visit2DScreen.module.css';
import { STUDENT_THEME } from '../student/theme.ts';

/**
 * 2D 대체 화면(P4-10, ADR-019, PLAN §6.12): 3D로 볼 수 없는 기기에서 액자를 하나씩 넘겨 본다 — 수업 중 빈 화면이 없게.
 * - 위: 전시 이름 · 지금 전시실(관 안 번호) · `소리`. 3D가 아니므로 함께 관람 사람 수는 없다.
 * - 가운데: 지금 작품 한 점 — 그림은 벽용 변형(없으면 썸네일)을 3D 벽과 같은 비율의 테·매트에, 글은 종이 카드(HTML 글자),
 *   소리는 명판 + 재생(배경음악이 낮아짐). 끝에는 출구(고마움 인사 · `처음부터 다시 보기` · `처음으로`).
 * - 아래: 크게 보기와 같은 캡션(`ZoomCaption`) · 공개 반응 · `반응 남기기`(켰을 때) → 반응 덮개.
 * - 넘기기: `‹ ›` · 좌우 키 · 밀기. 순서는 배치의 정지 지점 순서(작품만). 글 작품에 쪽이 여럿이면 쪽부터 넘긴다.
 * - 배경음악은 지금 작품이 있는 관의 곡. 바뀜 확인으로 배치가 바뀌어도 보던 작품을 이어 본다.
 */

export interface Visit2DScreenProps {
  /** `GET /api/e/{code}` 응답(OPEN 전시) */
  readonly view: ExhibitionView;
  /** 입장 코드(반응 덮개) */
  readonly code: string;
  /** 출구의 `처음으로` */
  readonly onHome: () => void;
  /** `소리` 켬/끔(기기에 기억). 없으면 이 화면 안에서만(켬으로 시작) */
  readonly sound?: { readonly on: boolean; readonly set: (on: boolean) => void } | undefined;
  /** 띠 "전시가 새로 바뀌었어요 `새로 보기`"(P4-9) */
  readonly pendingUpdate?: boolean | undefined;
  readonly onApplyUpdate?: (() => void) | undefined;
  /** 처음 볼 정지 지점(3D에서 넘어왔으면 보던 곳). 없으면 첫 작품 */
  readonly startStopId?: string | null | undefined;
  /** 지금 보는 정지 지점이 바뀔 때(바뀜 확인이 이어 볼 곳을 정할 때 쓴다) */
  readonly onStop?: ((stopId: string) => void) | undefined;
}

/** 소리 작품이 끝났는지 보는 간격(크게 보기 소리 명판과 같은 값 — 설정값 후보로 보고) */
const AUDIO_POLL_MS = 500;

const EXIT_SLIDE: Slide2D = { kind: 'exit', stopId: EXIT_STOP_ID };

const targetOf = (slide: Slide2D): SlideTarget =>
  slide.kind === 'artwork'
    ? { stopId: slide.stopId, artworkId: slide.artworkId, partId: slide.partId }
    : { stopId: slide.stopId };

/** 입력 칸에서 친 좌우 키는 넘기기가 아니다 */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export const Visit2DScreen = ({
  view,
  code,
  onHome,
  sound,
  pendingUpdate,
  onApplyUpdate,
  startStopId,
  onStop,
}: Visit2DScreenProps): JSX.Element => {
  const model = useMemo(() => visitModelOf(view), [view]);
  const byId = useMemo(() => new Map(model.artworks.map(a => [a.id, a])), [model.artworks]);
  const facts = useMemo(() => new Map(view.artworks.map(a => [a.id, a])), [view.artworks]);
  const slides = useMemo(() => slidesOf(model.layout, id => byId.has(id)), [model.layout, byId]);

  // 지금 자리: 장 대신 "보던 곳"을 기억한다 — 배치가 바뀌어도 같은 작품(없으면 같은 관 첫 작품)을 이어 보게
  const [pos, setPos] = useState<{ target: SlideTarget; page: number }>(() => {
    const st = startStopId ? view.layout.stops.find(x => x.id === startStopId) : undefined;
    const from = st ? { stopId: st.id, artworkId: st.artworkId, partId: st.partId } : null;
    return { target: targetOf(slides[resumeSlide(slides, from)] ?? EXIT_SLIDE), page: 0 };
  });
  const index = resumeSlide(slides, pos.target);
  // 위 전시실 탭(§6.12): 전시 순서대로, 누르면 그 전시실 첫 작품으로. 나뉜 관은 한 전시실로
  const roomOfPart = useMemo(
    () => new Map(model.layout.parts.map(p => [p.partId, p.roomId])),
    [model.layout],
  );
  const roomTabs = useMemo(() => {
    const first = new Map<string, number>();
    slides.forEach((sl, i) => {
      if (sl.kind !== 'artwork' || !sl.partId) return;
      const r = roomOfPart.get(sl.partId);
      if (r && !first.has(r)) first.set(r, i);
    });
    return [...view.rooms]
      .sort((a, b) => a.order - b.order)
      .flatMap(r => (first.has(r.id) ? [{ id: r.id, title: r.title, slide: first.get(r.id)! }] : []));
  }, [slides, roomOfPart, view.rooms]);
  const slide = slides[index] ?? EXIT_SLIDE;
  // 전시실 첫 작품에서 그 전시실 소개 글(교사가 쓴 것, PRD G-12 — 3D는 소개판, V-03)
  const introHere = useMemo(() => {
    const tab = roomTabs.find(t => t.slide === index);
    const intro = tab ? view.rooms.find(r => r.id === tab.id)?.intro : null;
    return tab && intro ? { title: tab.title, intro } : null;
  }, [roomTabs, index, view.rooms]);
  const art = slide.kind === 'artwork' ? byId.get(slide.artworkId) : undefined;
  const card = art ? model.cards.get(art.id) : undefined;
  const track = art ? model.tracks.get(art.id) : undefined;
  const kind = !art
    ? 'exit'
    : card?.kind === 'TEXT'
      ? 'text'
      : card?.kind === 'AUDIO' && track
        ? 'audio'
        : 'image';

  // 글 작품 쪽 수(카드가 재서 알려 줌). 다른 장으로 가면 1로 본다
  const [paged, setPaged] = useState<{ stopId: string; total: number }>({ stopId: '', total: 1 });
  const pages = kind === 'text' && paged.stopId === slide.stopId ? paged.total : 1;
  const page = Math.min(pos.page, pages - 1);
  const onPages = useCallback((total: number) => setPaged({ stopId: slide.stopId, total }), [slide.stopId]);

  // 덮개(반응)·안내 한 줄·캡션 접기
  const services = useContext(ServicesContext);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [reactionsOff, setReactionsOff] = useState(false);
  const canReact = services !== null && !reactionsOff && reactionsEnabled(view);
  const [notice, setNotice] = useState(true);
  const [folded, setFolded] = useState<string | null>(null);
  const captionOpen = folded !== slide.stopId;
  useEffect(() => {
    if (reactingId && art?.id !== reactingId) setReactingId(null);
  }, [art, reactingId]);

  // 넘긴 단추가 잠기거나(처음·출구에 닿음) 사라지면(출구의 `처음부터 다시 보기`) 초점이 사라지지 않게 옆 단추로(V-35)
  const prevBtn = useRef<HTMLButtonElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const restartBtn = useRef<HTMLButtonElement>(null);
  const focusFrom = useRef<'prev' | 'next' | 'restart' | null>(null);
  const focusedButton = (): 'prev' | 'next' | 'restart' | null => {
    const el = document.activeElement;
    if (el === null) return null;
    if (el === prevBtn.current) return 'prev';
    if (el === nextBtn.current) return 'next';
    return el === restartBtn.current ? 'restart' : null;
  };

  const move = (dir: 1 | -1): void => {
    const next = step2d(slides.length, { index, page }, dir, pages);
    if (next.index === index && next.page === page) return;
    focusFrom.current = focusedButton();
    setNotice(false);
    setPos({ target: targetOf(slides[next.index] ?? EXIT_SLIDE), page: next.page });
  };
  const restart = (): void => {
    focusFrom.current = focusedButton();
    setNotice(false);
    setPos({ target: targetOf(slides[0] ?? EXIT_SLIDE), page: 0 });
  };
  const moveRef = useRef(move);
  moveRef.current = move;
  const reactingRef = useRef(false);
  reactingRef.current = reactingId !== null;

  // 좌우 키(반응 덮개가 열린 동안·입력 칸에서는 받지 않음)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        reactingRef.current ||
        isTyping(e.target)
      )
        return;
      e.preventDefault();
      if (!e.repeat) moveRef.current(e.code === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // 밀기
  const swipe = useRef<{ id: number; x: number; y: number; t: number } | null>(null);

  // 바뀜 확인이 이어 볼 곳
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  useEffect(() => stopRef.current?.(slide.stopId), [slide.stopId]);

  // 다음·앞 그림을 미리 받아 둔다(넘길 때 빈 액자가 덜 보이게)
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      const near = slides[i];
      const src = near?.kind === 'artwork' ? byId.get(near.artworkId)?.imageSrc : null;
      if (src) new Image().src = src;
    }
  }, [index, slides, byId]);

  // 소리: 지금 작품이 있는 관의 배경음악. 켬/끔은 기기에 기억(없으면 이 화면 안에서만)
  const [localSound, setLocalSound] = useState(true);
  const soundOn = sound?.on ?? localSound;
  const setSound = sound?.set ?? setLocalSound;
  const region = slide.kind === 'artwork' && slide.partId !== null ? slide.partId : EXIT_STOP_ID;
  useRoomMusic({ view, region, entered: true, on: soundOn });

  const slot = useRef<HTMLDivElement>(null);
  const box = useBoxSize(slot);

  const place =
    slide.kind !== 'artwork' || slide.partId === null
      ? ''
      : slide.index !== null && slide.count !== null
        ? fill(copy.viewer.stopArtwork, {
            room: model.placeOf(slide.partId),
            index: slide.index,
            count: slide.count,
          })
        : model.placeOf(slide.partId);
  const fact = art ? facts.get(art.id) : undefined;
  const atStart = index === 0 && page === 0;
  const atEnd = index >= slides.length - 1;

  useEffect(() => {
    const from = focusFrom.current;
    focusFrom.current = null;
    if (from === null) return;
    if (atEnd && from === 'next') restartBtn.current?.focus();
    else if (atStart && from !== 'next') nextBtn.current?.focus();
  }, [atStart, atEnd, index]);

  return (
    <div
      className={s.stage}
      data-theme={STUDENT_THEME}
      data-testid="visit-2d"
      data-index={index}
      data-stop={slide.stopId}
      data-kind={kind}
      data-page={page}
    >
      <div className={s.wainscot} aria-hidden />

      <header className={s.top}>
        <div className={`${s.plate} ${s.titlePlate}`}>
          <span className={s.accentBar} aria-hidden />
          <span className={s.title}>{model.facade}</span>
          {place ? (
            <>
              <span className={s.sep} aria-hidden />
              {/* 넘길 때마다 자리(전시실 · 3/6)를 화면 읽기 도구가 읽는다 — 넘김은 늘 사용자 누름이라 시끄럽지 않다 */}
              <span className={s.place} data-testid="visit2d-place" aria-live="polite">
                {place}
              </span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className={`${s.plate} ${s.sound}`}
          aria-pressed={soundOn}
          aria-label={copy.viewer.sound}
          data-testid="sound-toggle"
          onClick={() => setSound(!soundOn)}
        >
          <Icon name={soundOn ? 'sound-on' : 'sound-off'} />
          <span className={s.soundLabel}>{copy.viewer.sound}</span>
        </button>
      </header>
      {roomTabs.length > 1 && (
        <nav className={s.tabs} aria-label={copy.view2d.rooms} data-testid="visit2d-tabs">
          {roomTabs.map(t => {
            const cur = slides[index];
            const on = cur?.kind === 'artwork' && !!cur.partId && roomOfPart.get(cur.partId) === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={s.tab}
                aria-current={on ? 'true' : undefined}
                onClick={() => setPos({ target: targetOf(slides[t.slide] ?? EXIT_SLIDE), page: 0 })}
              >
                {t.title}
              </button>
            );
          })}
        </nav>
      )}

      {(pendingUpdate && onApplyUpdate) || notice ? (
        <div className={s.overlays}>
          {pendingUpdate && onApplyUpdate ? (
            <div className={`${s.plate} ${s.banner}`} role="status" data-testid="update-banner">
              <span>{copy.viewer.updated}</span>
              <button type="button" className={s.primary} onClick={onApplyUpdate}>
                {copy.viewer.updatedAction}
              </button>
            </div>
          ) : null}
          {notice ? (
            <p className={`${s.plate} ${s.notice}`} role="status" data-testid="visit2d-notice">
              {copy.view2d.notice}
            </p>
          ) : null}
        </div>
      ) : null}

      <main
        className={s.wall}
        onPointerDown={e => {
          if (e.isPrimary === false) return;
          swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
        }}
        onPointerUp={e => {
          const st = swipe.current;
          swipe.current = null;
          if (!st || st.id !== e.pointerId || reactingRef.current) return;
          const dir = swipeDir(e.clientX - st.x, e.clientY - st.y, performance.now() - st.t);
          if (dir !== 0) move(dir);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <button
          type="button"
          className={`${s.side} ${s.prev}`}
          aria-label={copy.viewer.prevArtwork}
          ref={prevBtn}
          disabled={atStart}
          data-testid="visit2d-prev"
          onClick={() => move(-1)}
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <div className={s.slot} ref={slot}>
          <div key={slide.stopId} className={s.slide}>
            {kind === 'exit' ? (
              <section
                className={`${s.plate} ${s.exit}`}
                data-testid="visit2d-exit"
                aria-label={copy.viewer.exitThanks}
              >
                <p className={s.exitTitle}>{copy.viewer.exitThanks}</p>
                <p className={s.exitSub}>{fill(copy.viewer.exitCount, { n: model.artworks.length })}</p>
                <div className={s.exitActions}>
                  <button type="button" className={s.primary} onClick={restart} ref={restartBtn}>
                    {copy.viewer.restart}
                  </button>
                  <button type="button" className={s.secondary} onClick={onHome}>
                    {copy.closed.home}
                  </button>
                </div>
              </section>
            ) : kind === 'text' && card && art ? (
              <TextCard2D
                text={card}
                page={page}
                onPages={onPages}
                box={box}
                aspect={art.art.w / art.art.h}
              />
            ) : kind === 'audio' && card && track ? (
              <AudioPlate2D text={card} track={track} />
            ) : art ? (
              <ArtworkFrame
                art={art}
                thumb={model.textures.urlOf(art.id, 'thumb')}
                dark={art.matColor === model.look.mat.dark}
                box={box}
              />
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className={`${s.side} ${s.next}`}
          aria-label={copy.viewer.nextArtwork}
          ref={nextBtn}
          disabled={atEnd}
          data-testid="visit2d-next"
          onClick={() => move(1)}
        >
          <Icon name="chevron-right" size={24} />
        </button>
      </main>

      {art ? (
        <div className={s.caption}>
          {introHere ? (
            <section
              className={`${s.plate} ${s.roomIntro}`}
              data-testid="visit2d-room-intro"
              aria-label={introHere.title}
            >
              <p className={s.roomIntroTitle}>{introHere.title}</p>
              <p className={s.roomIntroText}>{introHere.intro}</p>
            </section>
          ) : null}
          {captionOpen ? (
            <>
              <ZoomCaption
                key={art.id}
                title={art.title}
                author={art.author}
                caption={art.caption}
                description={fact?.description ?? null}
                featured={fact?.featured ?? false}
                onClose={() => setFolded(slide.stopId)}
                foldable={false}
                onReact={canReact ? () => setReactingId(art.id) : undefined}
              />
              {services ? <PublicReactionsFor view={view} artworkId={art.id} /> : null}
            </>
          ) : (
            <button
              type="button"
              className={`${s.plate} ${s.showCaption}`}
              data-testid="visit2d-show-caption"
              onClick={() => setFolded(null)}
            >
              {copy.view2d.showCaption}
            </button>
          )}
        </div>
      ) : null}

      {services ? <ReactionOutbox exhibitionId={view.exhibition.id} /> : null}
      {services && reactingId ? (
        <ReactionLayer
          key={reactingId}
          view={view}
          code={code}
          artworkId={reactingId}
          onClose={() => setReactingId(null)}
          onUnavailable={c => {
            if (c === 'E_REACTIONS_OFF') setReactionsOff(true);
          }}
        />
      ) : null}
    </div>
  );
};

/** 상자 크기(px). 크기가 바뀌면(돌리기·창 크기) 다시 */
const useBoxSize = (ref: RefObject<HTMLElement | null>): { w: number; h: number } => {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox(b => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
};

/** 그림 작품: 3D 벽과 같은 비율의 테·매트 안에 벽용 그림. 받는 동안은 썸네일을 먼저 */
const ArtworkFrame = ({
  art,
  thumb,
  dark,
  box,
}: {
  art: ViewerArtwork;
  thumb: string | null;
  dark: boolean;
  box: { w: number; h: number };
}) => {
  const fit = fitFrame(box, art.art, art.mat, art.frame);
  return (
    <figure
      className={s.frame}
      data-mat={dark ? 'dark' : 'light'}
      data-testid="visit2d-frame"
      style={
        fit ? { width: fit.outerW, height: fit.outerH, borderWidth: fit.frame, padding: fit.mat } : undefined
      }
    >
      <div className={s.art} style={fit ? { width: fit.artW, height: fit.artH } : undefined}>
        {thumb && thumb !== art.imageSrc ? (
          <img className={s.thumb} src={thumb} alt="" aria-hidden draggable={false} />
        ) : null}
        {art.imageSrc ? (
          <img className={s.picture} src={art.imageSrc} alt={art.title} draggable={false} decoding="async" />
        ) : null}
      </div>
    </figure>
  );
};

/** 소리 작품 명판: 재생/멈춤(배경음악이 낮아짐). 다른 작품으로 넘기면 멈춘다 */
const AudioPlate2D = ({ text, track }: { text: CardText; track: Track }) => {
  const [playing, setPlaying] = useState(false);
  useEffect(
    () => () => {
      audioEngine().stopArtwork();
    },
    [],
  );
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (audioEngine().snapshot().artwork.paused) setPlaying(false);
    }, AUDIO_POLL_MS);
    return () => window.clearInterval(t);
  }, [playing]);
  return (
    <section className={`${s.plate} ${s.audio}`} data-testid="visit2d-audio" aria-label={text.title}>
      <span className={s.audioMark} aria-hidden>
        <Icon name="sound-on" size={28} />
      </span>
      <h2 className={s.audioTitle}>{text.title}</h2>
      {text.author ? <p className={s.audioAuthor}>{text.author}</p> : null}
      <button
        type="button"
        className={s.primary}
        aria-pressed={playing}
        data-testid="visit2d-play"
        onClick={() => {
          if (playing) {
            audioEngine().stopArtwork();
            setPlaying(false);
            return;
          }
          void audioEngine()
            .unlock()
            .then(() => {
              audioEngine().playArtwork(track);
              setPlaying(true);
            });
        }}
      >
        <Icon name={playing ? 'sound-off' : 'play'} />
        <span>{playing ? copy.viewer.stopSound : copy.viewer.playSound}</span>
      </button>
    </section>
  );
};

/** 반응 보내기 줄을 관람 중 늘 살려 둔다(3D 관람 화면과 같음, ADR-049) */
const ReactionOutbox = ({ exhibitionId }: { exhibitionId: string }) => {
  useReactionPending(exhibitionId);
  return null;
};
