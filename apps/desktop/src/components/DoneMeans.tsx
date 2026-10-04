import { Plus, X } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { Baseline, Product } from '../../../../packages/contracts/src/index';
import { reconcilePlan } from '../renderer/delivery-progress';
import { plural } from '../renderer/requirement-status';

/** Next unused requirement ID; retired IDs are never reused. */
function nextId(product: Product, baseline: Baseline): string {
  /** Numeric part of a REQ-n identifier. */
  const n = (id: string) => Number(id.slice(4));
  const highest = Math.max(
    0,
    ...product.requirements.map((r) => n(r.id)),
    ...baseline.retiredIds.map(n),
    ...baseline.product.requirements.map((r) => n(r.id)),
  );
  return `REQ-${highest + 1}`;
}

/** Inline editor for what done means; saving makes it the new baseline and Aiden looks again. */
function ProductEditor({
  baseline,
  busy,
  onSave,
  onClose,
}: {
  baseline: Baseline;
  busy: boolean;
  onSave: (product: Product) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Product>(baseline.product);
  /** Change one requirement in the draft. */
  const update = (id: string, change: Partial<Product['requirements'][number]>) =>
    setDraft({
      ...draft,
      requirements: draft.requirements.map((r) => (r.id === id ? { ...r, ...change } : r)),
    });
  return (
    <div className="done-means-editor">
      <label>
        Overview
        <textarea
          value={draft.overview}
          onChange={(e) => setDraft({ ...draft, overview: e.target.value })}
        />
      </label>
      {draft.requirements.map((r) => (
        <div className="requirement" key={r.id}>
          <span>{r.id}</span>
          <div>
            <textarea
              aria-label={r.id}
              value={r.text}
              onChange={(e) => update(r.id, { text: e.target.value })}
            />
            {r.edgeCases?.map((edge) => (
              <p className="edge-case-edit" key={edge.id}>
                {edge.id}. {edge.text}
                <button
                  className="icon-button"
                  aria-label={`Remove ${r.id} ${edge.id}`}
                  onClick={() =>
                    update(r.id, { edgeCases: r.edgeCases!.filter((e) => e.id !== edge.id) })
                  }
                >
                  <X size={13} />
                </button>
              </p>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label={`Remove ${r.id}`}
            onClick={() =>
              setDraft({ ...draft, requirements: draft.requirements.filter((q) => q.id !== r.id) })
            }
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <button
        className="text-button"
        onClick={() =>
          setDraft({
            ...draft,
            requirements: [...draft.requirements, { id: nextId(draft, baseline), text: '' }],
          })
        }
      >
        <Plus size={14} /> Add requirement
      </button>
      <div className="button-row">
        <button
          className="primary"
          disabled={
            busy || !draft.requirements.length || draft.requirements.some((r) => !r.text.trim())
          }
          onClick={() => void onSave(reconcilePlan(draft)).then(onClose)}
        >
          Save and run check
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Inline editor for the intent itself; saving makes Aiden rewrite what done means. */
function IntentEditor({
  context,
  busy,
  onSave,
  onClose,
}: {
  context: string;
  busy: boolean;
  onSave: (context: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(context);
  return (
    <div className="done-means-editor">
      <textarea
        aria-label="What you are building"
        className="context"
        maxLength={20000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="button-row">
        <button
          className="primary"
          disabled={busy || !draft.trim() || draft === context}
          onClick={() => void onSave(draft.trim()).then(onClose)}
        >
          Rewrite requirements
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * What done means: the intent in your words and the requirements Aiden holds the work to, with
 * the edge cases it watches. Both stay editable; editing either counts as changing the intent.
 */
export function DoneMeans({
  baseline,
  context,
  busy,
  onEditProduct,
  onEditContext,
}: {
  baseline: Baseline;
  context: string;
  busy: boolean;
  onEditProduct: (product: Product) => Promise<void>;
  onEditContext: (context: string) => Promise<void>;
}): JSX.Element {
  const [editing, setEditing] = useState<'product' | 'intent' | null>(null);
  const edges = baseline.product.requirements.reduce((n, r) => n + (r.edgeCases?.length ?? 0), 0);
  return (
    <details className="brief-card done-means" aria-label="Scope" open>
      <summary className="card-label">
        Scope · {plural(baseline.product.requirements.length, 'requirement')},{' '}
        {plural(edges, 'edge case')}
      </summary>
      {editing === 'intent' ? (
        <IntentEditor
          context={context}
          busy={busy}
          onSave={onEditContext}
          onClose={() => setEditing(null)}
        />
      ) : (
        <blockquote className="intent">
          {context}{' '}
          <button className="text-button" disabled={busy} onClick={() => setEditing('intent')}>
            Edit goal
          </button>
        </blockquote>
      )}
      {editing === 'product' ? (
        <ProductEditor
          baseline={baseline}
          busy={busy}
          onSave={onEditProduct}
          onClose={() => setEditing(null)}
        />
      ) : (
        <>
          <p>{baseline.product.overview}</p>
          <ol className="done-means-list">
            {baseline.product.requirements.map((r) => (
              <li key={r.id}>
                <strong>{r.id}</strong> {r.text}
                {r.edgeCases && r.edgeCases.length > 0 && (
                  <details className="scope-edge-cases">
                    <summary>{plural(r.edgeCases.length, 'edge case')}</summary>
                    <ul>
                      {r.edgeCases.map((e) => (
                        <li key={e.id}>
                          {e.text}
                          {e.origin === 'found' && <em className="found-tag"> Found by Aiden</em>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
          <button className="text-button" disabled={busy} onClick={() => setEditing('product')}>
            Edit scope
          </button>
        </>
      )}
    </details>
  );
}
