import { copy } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './DocentCard.module.css';

export interface DocentCardProps {
  /** 대사 한 줄 */
  readonly text: string;
  /** 도슨트 이름(없으면 `copy.museumDocent.name`) */
  readonly name?: string | undefined;
  /** 얼굴 그림 주소. 없으면 말하기 아이콘 동그라미 자리 */
  readonly src?: string | undefined;
  readonly onClose: () => void;
  readonly className?: string | undefined;
}

/**
 * 도슨트 대사 카드(PRD_V2 W-10, M4-8): 화면 아래 작은 안내판 — 얼굴 동그라미 · 이름 · 대사 · 닫기.
 * `role="status"`: 말걸기는 걷는 중에 잠깐 뜨는 안내라 초점을 가져가지 않는다(`dialog`면 초점이 옮겨 가 Space·방향키 걷기가 끊김).
 * 화면 읽기는 새 대사를 조용히 읽는다. 닫힘(멀어짐·걸음·시간)은 부르는 쪽이 정하고, 이 부품은 보여 주기만 한다.
 * 동작 줄이기면 올라오는 효과가 없다.
 */
export const DocentCard = ({ text, name, src, onClose, className }: DocentCardProps): JSX.Element => (
  <section
    className={className ? `${s.card} ${className}` : s.card}
    role="status"
    aria-label={copy.museumDocent.talkCard}
    data-testid="docent-card"
  >
    <span className={s.face} aria-hidden="true">
      {src ? <img className={s.faceImg} src={src} alt="" /> : <Icon name="talk" size={20} />}
    </span>
    <div className={s.body}>
      <span className={s.name}>{name ?? copy.museumDocent.name}</span>
      <p className={s.text}>{text}</p>
    </div>
    <button type="button" className={s.close} onClick={onClose} aria-label={copy.museumDocent.close}>
      <Icon name="close" size={18} />
    </button>
  </section>
);
