import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { JSX } from 'react';

import type { DeliveryAttention as Attention } from '../renderer/delivery-attention';

/** A concise finding above progress, with actions in chat and evidence in Activity. */
export function DeliveryAttention({
  items,
  busy,
  onCheck,
  onReview,
  onEvidence,
}: {
  items: Attention[];
  busy: boolean;
  onCheck: () => void;
  onReview: (item: Attention) => void;
  onEvidence: () => void;
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
        <div>
          <h2>
            {deviations
              ? `Delivery at risk · ${deviations} ${deviations === 1 ? 'deviation' : 'deviations'}`
              : 'Delivery needs verification'}
          </h2>
        </div>
      </header>
      {items.map((item) => (
        <article className="attention-item" key={item.featureId}>
          <div className="attention-item-heading">
            <h3>{item.title}</h3>
            <AttentionBadge item={item} />
          </div>
          <p>{item.summary}</p>
          <div className="attention-actions">
            <button className="text-button" onClick={() => onReview(item)}>
              Review with Aiden <ArrowRight size={14} aria-hidden="true" />
            </button>
            <button className="text-button" onClick={onEvidence}>
              View evidence
            </button>
            {item.remote?.url && (
              <a href={item.remote.url} target="_blank" rel="noreferrer">
                Open {item.remote.issueId ?? 'ticket'}
              </a>
            )}
            {item.kind === 'unverified' && (
              <button className="text-button" disabled={busy} onClick={onCheck}>
                Run check again
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

/** Keep the same discrepancy label visible on collapsed features and requirements. */
export function AttentionBadge({ item }: { item: Attention }): JSX.Element {
  return <span className={`attention-badge attention-badge--${item.kind}`}>{item.label}</span>;
}
