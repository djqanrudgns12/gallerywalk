import { copy } from '@gallery/core/copy';
import { useEffect, useRef } from 'react';
import { Icon } from '../../../ui/Icon.tsx';
import { HELP_KEYS } from './keys.ts';
import s from './KeysHelp.module.css';

/** 액자 키 도움말(G-32, HT-09, `?`). 덮개 하나 — 열면 다른 덮개는 닫힌다. Esc·닫기로 닫힌다 */
export const KeysHelp = ({ onClose }: { readonly onClose: () => void }) => {
  const k = copy.teacher.keys;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 닫히면 열기 전 자리(누른 액자)로 초점을 되돌린다(검토 L9)
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => back?.focus();
  }, []);
  return (
    <div className={s.sheet} role="dialog" aria-modal="false" aria-label={k.title} data-testid="keys-help">
      <header className={s.head}>
        <h2 className={s.title}>{k.title}</h2>
        <button type="button" ref={closeRef} className={s.close} onClick={onClose} aria-label={k.close}>
          <Icon name="close" />
        </button>
      </header>
      <dl className={s.list}>
        {HELP_KEYS.map(key => (
          <div key={key} className={s.row}>
            <dt>
              <kbd className={s.kbd}>{k.keys[key]}</kbd>
            </dt>
            <dd className={s.what}>{k[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
