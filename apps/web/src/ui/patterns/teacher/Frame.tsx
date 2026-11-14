import type { CSSProperties, JSX, ReactNode } from 'react';
import { memo } from 'react';
import s from './Frame.module.css';

/** 액자 높이 3단: 크게 92px · 작게 56px · 태블릿 크게 72px (높이의 출처는 tokens.css `--frame-h-*`) */
export type FrameSize = 'big' | 'small' | 'tablet';

/** 그림 비율 갈래. 실제 그림 비율을 알면 `ratio`로 덮어쓴다. */
export type FrameShape = 'landscape' | 'portrait' | 'square' | 'wide' | 'tall';

export interface FrameProps {
  /** 작은 그림 주소. 없으면 빈 그림 자리(또는 `children`)를 그린다. */
  src?: string | null | undefined;
  /** 그림 대체 글(작품 제목 등). 화면 문구는 부르는 쪽이 `copy`에서 넘긴다. */
  alt: string;
  size?: FrameSize | undefined;
  shape?: FrameShape | undefined;
  /** 가로/세로 비율(예: 1.43). 주면 `shape`보다 앞선다. */
  ratio?: number | undefined;
  /** 대표작: 1.2배 크게, 바랜 황동 테 */
  featured?: boolean | undefined;
  /** 숨김·처리 중처럼 흐리게 보일 때 */
  blurred?: boolean | undefined;
  /** 확인할 것: 액자 귀퉁이 점 하나 */
  flag?: boolean | undefined;
  /** 확인할 것 점을 화면 낭독기에 알릴 글(눈에는 안 보임) */
  flagLabel?: string | undefined;
  /** 고른 작품: 남색 테두리 */
  selected?: boolean | undefined;
  /** 끄는 중 놓일 빈자리(점선 빈칸, 그림은 감춤) */
  lifted?: boolean | undefined;
  /** 그림이 없을 때 매트 안에 그릴 것(소리 작품 표시 등) */
  children?: ReactNode;
  className?: string | undefined;
}

const cx = (...names: ReadonlyArray<string | false | null | undefined>): string =>
  names.filter(Boolean).join(' ');

/**
 * 액자(테 → 흰 매트 → 그림)와 걸린 그림자(G-32, FIELD_PLAN §5.4 ②).
 * 누르기·끌기는 감싸는 쪽이 맡고, 이 부품은 그리기만 한다. 그림 `<img>`는 브라우저 자체 그림 끌기와
 * 길게 누르기 그림 메뉴가 끌어 놓기를 가로채지 않게 `draggable={false}`이고 CSS로 메뉴·고르기를 막는다.
 */
const FrameBase = ({
  src,
  alt,
  size = 'big',
  shape = 'landscape',
  ratio,
  featured = false,
  blurred = false,
  flag = false,
  flagLabel,
  selected = false,
  lifted = false,
  children,
  className,
}: FrameProps): JSX.Element => {
  const style: CSSProperties | undefined =
    ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? { aspectRatio: String(ratio) } : undefined;
  const hasImage = typeof src === 'string' && src.length > 0;

  return (
    <span
      className={cx(
        s.frame,
        s[size],
        s[shape],
        featured && s.featured,
        blurred && s.blurred,
        selected && s.selected,
        lifted && s.lifted,
        className,
      )}
      style={style}
      data-frame=""
      data-size={size}
      data-shape={shape}
      data-featured={featured ? 'true' : undefined}
      data-blurred={blurred ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-lifted={lifted ? 'true' : undefined}
      data-flag={flag ? 'true' : undefined}
      role={hasImage ? undefined : 'img'}
      aria-label={hasImage ? undefined : alt}
    >
      <span className={s.mat}>
        <span className={s.art}>
          {hasImage ? (
            <img className={s.img} src={src} alt={alt} draggable={false} loading="lazy" decoding="async" />
          ) : (
            (children ?? null)
          )}
        </span>
      </span>
      {flag ? <span className={s.flag} aria-hidden="true" data-frame-flag="" /> : null}
      {flag && flagLabel ? <span className={s.srOnly}>{flagLabel}</span> : null}
    </span>
  );
};

/** 작품 40점이 끄는 동안 다시 그려지지 않게 `memo`로 감싼다(FIELD_PLAN §5.7 위험). */
export const Frame = memo(FrameBase);
Frame.displayName = 'Frame';
