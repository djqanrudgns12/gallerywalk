import { copy } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import { ArtworkCard, type ArtworkCardProps } from './ArtworkCard.tsx';
import s from './ArtworkGrid.module.css';

export interface ArtworkGridProps {
  items: readonly ArtworkCardProps[];
  onAddMore?: (() => void) | undefined;
  onSelectCard?: ((id: string) => void) | undefined;
  addTitle?: string | undefined;
  addSubtitle?: string | undefined;
  className?: string | undefined;
}

export const ArtworkGrid = ({
  items,
  onAddMore,
  onSelectCard,
  addTitle = copy.viewer.more,
  addSubtitle,
  className,
}: ArtworkGridProps): JSX.Element => (
  <section
    className={className ? `${s.grid} ${className}` : s.grid}
    aria-label={copy.viewer.collection}
    data-testid="artwork-grid"
  >
    {items.map(item => (
      <ArtworkCard key={item.id} {...item} onSelect={item.onSelect ?? onSelectCard} />
    ))}

    <button
      type="button"
      className={s.addCard}
      onClick={onAddMore}
      aria-label={addTitle}
      data-testid="add-artwork-card"
    >
      <Icon name="plus" size={26} className={s.addIcon} />
      <span className={s.addTitle}>{addTitle}</span>
      {addSubtitle ? <span className={s.addSub}>{addSubtitle}</span> : null}
    </button>
  </section>
);
