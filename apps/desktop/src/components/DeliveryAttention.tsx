import { AlertTriangle } from 'lucide-react';
import type { JSX } from 'react';

import type { DeliveryAttention as Attention } from '../renderer/delivery-attention';

/**
 * Delivery findings above progress, one line each: the feature and its finding. The line opens
 * the affected requirement's pop-up, where the summary, impact, evidence, and next step live.
 */
export function DeliveryAttention({
  items,
  busy,
  onCheck,
  onOpen,
}: {
  items: Attention[];
  busy: boolean;
  onCheck: () => void;
  onOpen: (requirementId: string) => void;
}): JSX.Element | null {
  if (!items.length) return null;
  const deviations = items.filter((item) => item.kind === 'deviation').length;
  return (
    <section
      className={`delivery-attention delivery-attention--${deviations ? 'deviation' : 'pending'}`}
      aria-label="Delivery attention"
    >
      <header className="attention-heading">
        <AlertTriangle size={20} aria-hidden="true" />
        <h2>
          {deviations
            ? `Delivery at risk · ${deviations} ${deviations === 1 ? 'deviation' : 'deviations'}`
            : 'Delivery needs verification'}
        </h2>
        {items.some((item) => item.kind === 'unverified') && (
          <button className="text-button" disabled={busy} onClick={onCheck}>
            Run check again
          </button>
        )}
      </header>
      <ul className="attention-rows">
        {items.map((item) => (
          <li className="attention-row" key={item.featureId}>
            <button
              type="button"
              className="attention-open"
              aria-haspopup="dialog"
              onClick={() => onOpen(item.requirementIds[0]!)}
            >
              {item.title}
            </button>
            <AttentionBadge item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The same finding label on the attention row, the feature, and the requirement; hover for the summary. */
export function AttentionBadge({ item }: { item: Attention }): JSX.Element {
  return (
    <span className={`attention-badge attention-badge--${item.kind}`} title={item.summary}>
      {item.label}
    </span>
  );
}
