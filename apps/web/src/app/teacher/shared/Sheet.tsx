import { copy } from '@gallery/core/copy';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Icon } from '../../../ui/Icon.tsx';
import s from './Sheet.module.css';

export interface SheetProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** 시트 아래 줄(주요 버튼 등) */
  readonly footer?: ReactNode;
  /** `full` = 전체 화면(QR 크게 띄우기) */
  readonly size?: 'normal' | 'full';
  readonly testId?: string;
}

/**
 * 교사 화면의 덮개 하나(PRD 9.6 "동시에 열린 창 하나 이하"). 휴대폰(767px 이하)은 아래에서 올라오는 둥근 시트,
 * 그보다 넓으면 가운데 창. Esc·덮개 바깥 누르기·`닫기`로 닫는다. 열 때 첫 조작 칸으로 초점을 옮기고 닫으면 되돌린다.
 * 한 화면이 시트를 둘 이상 동시에 그리지 않도록 부르는 쪽이 덮개 상태 하나로 고른다.
 */
export const Sheet = ({ title, onClose, children, footer, size = 'normal', testId }: SheetProps) => {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);

  return (
    <div
      className={s.backdrop}
      data-size={size}
      onPointerDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <header className={s.head}>
          <h2 id={titleId} className={s.title}>
            {title}
          </h2>
          <button type="button" className={s.close} onClick={onClose} aria-label={copy.viewer.close}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className={s.body}>{children}</div>
        {footer ? <footer className={s.footer}>{footer}</footer> : null}
      </section>
    </div>
  );
};
