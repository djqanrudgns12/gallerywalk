import type { JSX } from 'react';

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'map'
  | 'sound-on'
  | 'sound-off'
  | 'menu'
  | 'zoom-in'
  | 'close'
  | 'user'
  | 'plus'
  | 'grid'
  | 'warning'
  | 'play'
  | 'check'
  | 'run'
  | 'jump'
  | 'pause'
  | 'heart'
  | 'bulb'
  | 'star'
  | 'question'
  | 'eye'
  | 'talk'
  | 'exit'
  | 'rejoin'
  // 교사 작업 화면 v3(G-32)
  | 'music'
  | 'grip'
  | 'pencil'
  | 'undo'
  | 'upload'
  | 'trash'
  | 'cube'
  | 'route'
  | 'signal'
  | 'qr';

export interface IconProps {
  name: IconName;
  size?: number | undefined;
  className?: string | undefined;
  label?: string | undefined;
}

const renderPaths = (name: IconName): JSX.Element => {
  switch (name) {
    case 'pause':
      return (
        <>
          <line x1="9" y1="5" x2="9" y2="19" />
          <line x1="15" y1="5" x2="15" y2="19" />
        </>
      );
    // 반응 스티커(G-07): 감동했어요 · 새로 알았어요 · 멋져요 · 궁금해요
    case 'heart':
      return <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />;
    case 'bulb':
      return (
        <>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
        </>
      );
    case 'star':
      return (
        <polygon points="12 3 14.8 8.9 21 9.6 16.4 13.8 17.7 20 12 16.9 6.3 20 7.6 13.8 3 9.6 9.2 8.9" />
      );
    case 'question':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14" />
          <line x1="12" y1="17" x2="12" y2="17.01" />
        </>
      );
    // 3D 미리 보기(P5-6)
    case 'eye':
      return (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case 'chevron-left':
      return <polyline points="15 5 8 12 15 19" />;
    case 'chevron-right':
      return <polyline points="9 5 16 12 9 19" />;
    case 'map':
      return (
        <>
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
          <line x1="9" y1="3" x2="9" y2="18" />
          <line x1="15" y1="6" x2="15" y2="21" />
        </>
      );
    case 'sound-on':
      return (
        <>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.8 5.5a9.5 9.5 0 0 1 0 13" />
        </>
      );
    case 'sound-off':
      return (
        <>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      );
    case 'menu':
      return (
        <>
          <circle cx="5" cy="12" r="1.4" fill="currentColor" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <circle cx="19" cy="12" r="1.4" fill="currentColor" />
        </>
      );
    case 'zoom-in':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <line x1="15.5" y1="15.5" x2="21" y2="21" />
          <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
          <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
        </>
      );
    case 'close':
      return (
        <>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" />
        </>
      );
    case 'plus':
      return (
        <>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </>
      );
    case 'grid':
      return (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      );
    case 'warning':
      return (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <line x1="12" y1="9" x2="12" y2="13.5" />
          <circle cx="12" cy="17" r="0.8" fill="currentColor" />
        </>
      );
    case 'play':
      return <polygon points="7 5 19 12 7 19 7 5" />;
    case 'check':
      return <polyline points="5 12.5 9.5 17 19 7" />;
    case 'run':
      return (
        <>
          <polyline points="5 6 11 12 5 18" />
          <polyline points="12 6 18 12 12 18" />
        </>
      );
    // 관람 조작 v2(PRD_V2 W-01·W-08): 말걸기 · 나가기 · 재접속하기
    case 'talk':
      return (
        <>
          <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          <line x1="8" y1="10" x2="16" y2="10" />
          <line x1="8" y1="13" x2="13" y2="13" />
        </>
      );
    case 'exit':
      return (
        <>
          <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
          <polyline points="16 8 20 12 16 16" />
          <line x1="10" y1="12" x2="20" y2="12" />
        </>
      );
    case 'rejoin':
      return (
        <>
          <path d="M20 12a8 8 0 1 1-2.3-5.6" />
          <polyline points="20 4 20 9 15 9" />
        </>
      );
    case 'jump':
      return (
        <>
          <polyline points="7 10 12 5 17 10" />
          <line x1="12" y1="5" x2="12" y2="15" />
          <line x1="5" y1="19.5" x2="19" y2="19.5" />
        </>
      );
    // 교사 작업 화면 v3(G-32): 배경음악 · 판 손잡이 · 고치기 · 되돌리기 · 올리기 · 삭제 · 3D 자리 · 투어 경로 · 학교망 · QR
    case 'music':
      return (
        <>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </>
      );
    case 'grip':
      return (
        <>
          <circle cx="9" cy="6" r="1.2" fill="currentColor" />
          <circle cx="15" cy="6" r="1.2" fill="currentColor" />
          <circle cx="9" cy="12" r="1.2" fill="currentColor" />
          <circle cx="15" cy="12" r="1.2" fill="currentColor" />
          <circle cx="9" cy="18" r="1.2" fill="currentColor" />
          <circle cx="15" cy="18" r="1.2" fill="currentColor" />
        </>
      );
    case 'pencil':
      return (
        <>
          <path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
          <line x1="14" y1="7" x2="17" y2="10" />
        </>
      );
    case 'undo':
      return (
        <>
          <polyline points="9 7 5 11 9 15" />
          <path d="M5 11h9a5 5 0 0 1 0 10h-3" />
        </>
      );
    case 'upload':
      return (
        <>
          <polyline points="7 9 12 4 17 9" />
          <line x1="12" y1="4" x2="12" y2="16" />
          <path d="M4 16v3h16v-3" />
        </>
      );
    case 'trash':
      return (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <path d="M9 7V4h6v3" />
          <path d="M6 7l1 13h10l1-13" />
        </>
      );
    case 'cube':
      return (
        <>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <polyline points="4 7.5 12 12 20 7.5" />
          <line x1="12" y1="12" x2="12" y2="21" />
        </>
      );
    case 'route':
      return (
        <>
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" strokeDasharray="2 2.5" />
        </>
      );
    case 'signal':
      return (
        <>
          <path d="M3 9a13 13 0 0 1 18 0" />
          <path d="M6.5 12.5a8 8 0 0 1 11 0" />
          <path d="M10 16a3 3 0 0 1 4 0" />
          <line x1="12" y1="19.5" x2="12" y2="19.51" />
        </>
      );
    case 'qr':
      return (
        <>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <line x1="14" y1="14" x2="14" y2="16" />
          <line x1="17" y1="14" x2="20" y2="14" />
          <line x1="17" y1="17" x2="17" y2="20" />
          <line x1="20" y1="18" x2="20" y2="20" />
        </>
      );
  }
};

export const Icon = ({ name, size = 24, className, label }: IconProps): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    data-icon={name}
  >
    {renderPaths(name)}
  </svg>
);
