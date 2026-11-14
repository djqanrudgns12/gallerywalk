import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { ExhibitionTeacher, Layout, LiveStats } from '@gallery/core/types';
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { encode } from 'uqr';
import { Icon } from '../../../ui/Icon.tsx';
import { StackBar, StatNumber, type StackBarPart } from '../../../ui/patterns/teacher/index.ts';
import { formatDay } from '../../student/posterView.ts';
import { shortStudentUrl, studentUrl } from '../shared/links.ts';
import { FloorPlan } from './FloorPlan.tsx';
import { qrPath } from './QrCode.tsx';
import { useLiveStats } from './useLiveStats.ts';
import s from './ClassTab.module.css';

export interface ClassTabProps {
  readonly exhibition: ExhibitionTeacher;
  readonly layout: Layout | null;
  readonly roomOrder: readonly string[];
  readonly reactionCount: number;
  readonly showBubbles: boolean;
  readonly onShowQr: () => void;
  readonly onStartTour: () => void;
  readonly onOpenReactions: () => void;
  readonly onCheckNetwork: () => void;
  readonly onPreload: () => void;
  readonly onOpen: () => void;
  readonly onCloseExhibition: () => void;
}

/** 지금 관람 수를 화면 칸으로 나눈 것. 세 칸(전시실 안·홀·광장·복도·위치 없음)의 합 = `visitors` */
export interface LiveSplit {
  readonly visitors: number;
  readonly inRooms: number;
  readonly elsewhere: number;
  readonly noPose: number;
  readonly teachers: number;
  readonly light: number;
  /** 전시실별 수(지도 점) */
  readonly counts: ReadonlyMap<string, number>;
}

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

/**
 * `GET …/live` 응답 → 화면 칸. 서버는 `visitors = Σrooms + elsewhere + noPose`로 보낸다(HT-16).
 * 나눔 칸이 없는 응답(옛 서버·배치 없음)이면 남는 수를 `위치 없음`에 넣어 막대 합이 늘 `visitors`가 되게 한다.
 */
export const liveSplit = (stats: LiveStats): LiveSplit => {
  const counts = new Map<string, number>();
  for (const room of stats.rooms ?? []) counts.set(room.roomId, (counts.get(room.roomId) ?? 0) + room.count);
  const inRooms = sum(counts.values());
  const elsewhere = stats.elsewhere ?? 0;
  const noPose = stats.noPose ?? Math.max(0, stats.visitors - inRooms - elsewhere);
  return {
    visitors: stats.visitors,
    inRooms,
    elsewhere,
    noPose,
    teachers: stats.teachers,
    light: stats.light,
    counts,
  };
};

/** 입장 코드를 세 자리씩 띄어 읽기 쉽게(칠판에 옮겨 적기 좋게). 값은 그대로 `data-code`에 */
const groupDigits = (code: string): string => code.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** 지도 칸의 실제 크기(px). 잴 수 있기 전(크기 0)에는 `null` — 지도는 크기가 생긴 뒤에 그린다 */
const useBoxSize = (): [RefObject<HTMLDivElement | null>, { width: number; height: number } | null] => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const width = Math.floor(el.clientWidth);
      const height = Math.floor(el.clientHeight);
      if (width <= 0 || height <= 0) return;
      setSize(prev => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
};

/** 학생 입장 QR(종이 한 장). 조용한 여백 4칸(표준)은 `QrCode`와 같다. 주소 글은 옆에 따로 크게 적으므로 여기선 그리지 않는다 */
const QR_BORDER = 4;
const EntryQr = ({ url }: { readonly url: string }): ReactElement => {
  const qr = useMemo(() => encode(url, { ecc: 'M', border: QR_BORDER }), [url]);
  return (
    <svg
      className={s.qr}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={fill(copy.teacher.open.qrLabel, { url })}
      data-testid="class-qr"
      data-value={url}
    >
      <rect width={qr.size} height={qr.size} className={s.qrPaper} />
      <path d={qrPath(qr.data)} className={s.qrInk} />
    </svg>
  );
};

/** 자동 투어 타일 그림: 전시실 셋을 잇는 점선 경로(축측 모형을 줄인 모양) */
const TourGlyph = (): ReactElement => (
  <svg className={s.tourGlyph} viewBox="0 0 132 56" aria-hidden="true">
    <polygon className={s.glyphRoom} points="6,34 30,22 52,33 28,45" />
    <polygon className={s.glyphRoom} points="44,26 68,14 90,25 66,37" />
    <polygon className={s.glyphRoom} points="82,18 106,6 128,17 104,29" />
    <polyline className={s.glyphPath} points="20,36 40,30 58,27 78,22 96,19 112,14" />
  </svg>
);

/** 학교망 타일 그림: 낮은 것부터 높은 것까지 신호 막대 넷 */
const SIGNAL_BARS = 4;
const SignalGlyph = (): ReactElement => (
  <span className={s.signal} aria-hidden="true">
    {Array.from({ length: SIGNAL_BARS }, (_, i) => (
      <i key={i} className={s.signalBar} />
    ))}
  </span>
);

const PLACEHOLDER = '–';

/**
 * 관리 화면 수업 탭(HT-07, PRD G-26·G-32, FIELD_PLAN §5.4 ④): 수업 중 교사가 "지금 몇 명이 어느 전시실에 있나"를 한눈에 본다.
 * - 큰 숫자(지금 관람 중) · 쌓은 막대(전시실 안 · 홀·광장·복도 · 위치 없음) · 선생님 수 · 가벼운 화면 한 줄(0이면 숨김)
 * - 가운데 축측 지도에 전시실별 학생 점(점 합 = 전시실 안 수). `LIVE_TEACHER_POLL_SEC`마다 새로(`useLiveStats`)
 * - 입장 QR 종이 · 입장 코드 · 짧은 주소 · `QR 크게 띄우기` / 그림 타일(자동 투어 · 말풍선 · 반응 수 · 학교망 점검 + 미리 불러오기)
 * - 삭제일 · `전시 닫기`. 열기 전(준비 중)·닫힌 뒤에는 큰 숫자 대신 안내와 `전시 열기`(`다시 열기`)
 * 개인 위치·별명은 다루지 않는다(전시실별 수만). 시트·확인 창은 부르는 쪽(관리 화면)이 연다.
 */
export const ClassTab = ({
  exhibition,
  layout,
  roomOrder,
  reactionCount,
  showBubbles,
  onShowQr,
  onStartTour,
  onOpenReactions,
  onCheckNetwork,
  onPreload,
  onOpen,
  onCloseExhibition,
}: ClassTabProps): ReactElement => {
  const t = copy.teacher.classTab;
  const opened = exhibition.status === 'OPEN';
  const stats = useLiveStats(exhibition.id, opened);
  const split = useMemo(() => (stats ? liveSplit(stats) : null), [stats]);
  const [mapRef, mapSize] = useBoxSize();
  const mapTitleId = useId();

  const parts: readonly StackBarPart[] = split
    ? [
        { key: 'rooms', value: split.inRooms, label: t.inRooms, tone: 'accent' },
        { key: 'elsewhere', value: split.elsewhere, label: t.elsewhere, tone: 'soft' },
        { key: 'noPose', value: split.noPose, label: t.noPose, tone: 'quiet' },
      ]
    : [];
  const url = studentUrl(exhibition.entryCode);
  const counts = opened && split ? split.counts : null;

  return (
    <section className={s.root} data-testid="class-tab" data-status={exhibition.status}>
      <header className={s.stats} data-testid="class-stats">
        {opened ? (
          <>
            <StatNumber
              size="xl"
              value={split ? split.visitors : PLACEHOLDER}
              label={t.watching}
              className={s.big}
            />
            {split ? (
              <div className={s.split}>
                <StackBar parts={parts} label={t.split} />
                <p className={s.meta}>
                  <span className={s.teachers} data-testid="class-teachers" data-count={split.teachers}>
                    <i className={s.plumDot} aria-hidden="true" />
                    {t.teachers}
                    <b className={s.metaCount}>{split.teachers}</b>
                  </span>
                  {split.light > 0 ? (
                    <span className={s.light} data-testid="class-light">
                      {fill(t.light, { n: split.light })}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <div className={s.notice}>
            <p className={s.noticeText} data-testid="class-notice">
              {exhibition.status === 'DRAFT' ? t.draftNotice : t.closedNotice}
            </p>
            <button type="button" className={s.primary} onClick={onOpen} data-testid="class-open">
              {exhibition.status === 'DRAFT' ? copy.teacher.manage.open : copy.teacher.menu.reopen}
            </button>
          </div>
        )}
      </header>

      <section className={s.mapCard} aria-labelledby={mapTitleId}>
        <div className={s.mapHead}>
          <h3 id={mapTitleId} className={s.mapTitle}>
            {opened ? t.mapTitle : copy.teacher.manage.mapLabel}
          </h3>
          {opened ? (
            <p className={s.mapHint}>{fill(t.mapHint, { sec: config().LIVE_TEACHER_POLL_SEC })}</p>
          ) : null}
        </div>
        <div ref={mapRef} className={s.mapBox} data-testid="class-map">
          {mapSize ? (
            <FloorPlan
              layout={layout}
              roomOrder={roomOrder}
              width={mapSize.width}
              height={mapSize.height}
              {...(counts ? { counts } : {})}
            />
          ) : null}
        </div>
      </section>

      <section className={s.entry} aria-label={t.entryLabel} data-testid="class-entry">
        <div className={s.qrSheet}>
          <EntryQr url={url} />
        </div>
        <div className={s.entryText}>
          <p className={s.codeLabel}>{copy.teacher.open.entryCode}</p>
          <p className={s.code} data-testid="class-entry-code" data-code={exhibition.entryCode}>
            {groupDigits(exhibition.entryCode)}
          </p>
          <p className={s.url} data-testid="class-short-url">
            {shortStudentUrl(exhibition.entryCode)}
          </p>
          {opened ? (
            <button type="button" className={s.primary} onClick={onShowQr} data-testid="class-show-qr">
              {copy.teacher.open.bigQr}
            </button>
          ) : null}
        </div>
        {opened ? <p className={s.entryHint}>{copy.teacher.open.studentHint}</p> : null}
      </section>

      <ul className={s.tiles} aria-label={t.toolsLabel} data-testid="class-tiles">
        <li className={s.tile} data-tile="tour">
          <div className={s.tileHead}>
            <span className={s.tileName}>{t.tour}</span>
            <button
              type="button"
              className={s.tileAction}
              onClick={onStartTour}
              aria-label={t.tourStartLabel}
              data-testid="class-tour"
            >
              {t.tourStart}
            </button>
          </div>
          <span className={s.tileHint}>{t.tourHint}</span>
          <TourGlyph />
        </li>

        {showBubbles ? (
          <li className={s.tile} data-tile="bubbles">
            <span className={s.tileName}>{t.bubbles}</span>
            <span className={s.tileHint}>{t.bubblesHint}</span>
            <span className={s.bubble} aria-hidden="true">
              <i className={s.sticker} data-sticker="star">
                <Icon name="star" size={14} />
              </i>
            </span>
          </li>
        ) : null}

        <li className={`${s.tile} ${s.flush}`} data-tile="reactions">
          <button type="button" className={s.tileHit} onClick={onOpenReactions} data-testid="class-reactions">
            <span className={s.tileHead}>
              <span className={s.tileName}>{t.reactions}</span>
              <Icon name="chevron-right" size={18} className={s.chevron} />
            </span>
            <span className={s.tileHint}>{t.reactionsHint}</span>
            <span className={s.tileFoot}>
              <b className={s.tileNumber} data-testid="class-reaction-count">
                {reactionCount}
              </b>
              <span className={s.pile} aria-hidden="true">
                <i className={s.sticker} data-sticker="heart">
                  <Icon name="heart" size={14} />
                </i>
                <i className={s.sticker} data-sticker="star">
                  <Icon name="star" size={14} />
                </i>
              </span>
            </span>
          </button>
        </li>

        <li className={`${s.tile} ${s.flush}`} data-tile="network">
          <button type="button" className={s.tileHit} onClick={onCheckNetwork} data-testid="class-network">
            <span className={s.tileHead}>
              <span className={s.tileName}>{t.network}</span>
              <Icon name="chevron-right" size={18} className={s.chevron} />
            </span>
            <span className={s.tileHint}>{t.networkHint}</span>
            <SignalGlyph />
          </button>
          <button type="button" className={s.preload} onClick={onPreload} data-testid="class-preload">
            <span>{copy.teacher.menu.preload}</span>
            <Icon name="chevron-right" size={16} />
          </button>
        </li>
      </ul>

      <footer className={s.foot}>
        <span className={s.expires}>
          {fill(copy.teacher.manage.deletesOn, { date: formatDay(exhibition.expiresAt) })}
        </span>
        {opened ? (
          <button type="button" className={s.close} onClick={onCloseExhibition} data-testid="class-close">
            {copy.teacher.menu.close}
          </button>
        ) : null}
      </footer>
    </section>
  );
};
