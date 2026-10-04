import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { JSX } from 'react';

import type { DeliveryAttention as Attention } from '../renderer/delivery-attention';

/** Open nested evidence with keyboard focus instead of linking to an invisible collapsed row. */
function revealRequirement(id: string): void {
  const row = document.getElementById(`requirement-${id}`);
  if (!row) return;
  let parent: HTMLElement | null = row;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  row.querySelector('summary')?.focus();
  row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/** A persistent summary above progress; evidence stays expandable and tracker links remain explicit. */
export function DeliveryAttention({
  items,
  busy,
  onCheck,
}: {
  items: Attention[];
  busy: boolean;
  onCheck: () => void;
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
          <p>Review the findings and verification gaps below.</p>
        </div>
      </header>
      {items.map((item) => (
        <article className="attention-item" key={item.featureId}>
          <div className="attention-item-heading">
            <h3>{item.title}</h3>
            <AttentionBadge item={item} />
          </div>
          <p>
            <strong>{item.summary}</strong>
          </p>
          <p>{item.impact}</p>
          <details className="attention-evidence">
            <summary>Evidence and next steps</summary>
            <ul>
              {item.evidence.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>{item.next}</p>
          </details>
          <div className="attention-actions">
            <button
              className="text-button"
              onClick={() => revealRequirement(item.requirementIds[0]!)}
            >
              Review requirement <ArrowRight size={14} aria-hidden="true" />
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
