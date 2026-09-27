import { Check, Layers, Plus, X } from 'lucide-react';
import React from 'react';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../../packages/contracts/src/api.js';
import type { Baseline, Product, Project } from '../../../../packages/contracts/src/index';

interface RequirementReviewProps {
  product: Product;
  baseline: Baseline | undefined;
  reviewRun: string;
  setProduct: React.Dispatch<React.SetStateAction<Product | undefined>>;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  project: Project;
  setBaseline: React.Dispatch<React.SetStateAction<Baseline | undefined>>;
  setReviewRun: React.Dispatch<React.SetStateAction<string>>;
  analyze: () => Promise<void>;
}

/** Edit the candidate requirements before approving a baseline. */
export function RequirementReview(props: RequirementReviewProps): React.JSX.Element {
  const {
    product,
    baseline,
    reviewRun,
    setProduct,
    busy,
    action,
    call,
    project,
    setBaseline,
    setReviewRun,
    analyze,
  } = props;
  return (
    <section className="card">
      <div className="card-heading">
        <div className="section-icon">
          <Layers size={19} />
        </div>
        <div>
          <h2>Reviewed baseline</h2>
          <p>Keep intended behavior separate from what the code currently does.</p>
        </div>
        <span className="count">{product.requirements.length} requirements</span>
      </div>
      <label>
        Overview
        <textarea
          value={product.overview}
          disabled={!!baseline && !reviewRun}
          onChange={(e) => setProduct({ ...product, overview: e.target.value })}
        />
      </label>
      <div className="requirements">
        {product.requirements.map((r, i) => (
          <div className="requirement" key={r.id}>
            <span>{r.id}</span>
            <textarea
              aria-label={r.id}
              disabled={!!baseline && !reviewRun}
              value={r.text}
              onChange={(e) =>
                setProduct({
                  ...product,
                  requirements: product.requirements.map((q, j) =>
                    i === j ? { ...q, text: e.target.value } : q,
                  ),
                })
              }
            />
            {reviewRun && (
              <button
                className="icon-button"
                aria-label={`Remove ${r.id}`}
                onClick={() =>
                  setProduct({
                    ...product,
                    requirements: product.requirements.filter((q) => q.id !== r.id),
                  })
                }
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {reviewRun && (
        <button
          className="text-button"
          onClick={() => {
            const n =
              Math.max(
                0,
                ...product.requirements.map((r) => Number(r.id.slice(4))),
                ...(baseline?.retiredIds ?? []).map((r) => Number(r.slice(4))),
                ...(baseline?.product.requirements ?? []).map((r) => Number(r.id.slice(4))),
              ) + 1;
            setProduct({
              ...product,
              requirements: [...product.requirements, { id: `REQ-${n}`, text: '' }],
            });
          }}
        >
          <Plus size={14} /> Add requirement
        </button>
      )}
      <div className="next-row">
        <span>Changes to project intent require a new review.</span>
        <button
          className="primary"
          disabled={
            busy || !product.requirements.length || product.requirements.some((r) => !r.text.trim())
          }
          onClick={() =>
            void action(async () => {
              if (reviewRun) {
                const b = await call('approve', {
                  projectId: project.id,
                  runId: reviewRun,
                  product,
                });
                setBaseline(b);
                setReviewRun('');
              }
              await analyze();
            })
          }
        >
          <Check size={16} />
          {reviewRun ? 'Approve & run analysis' : 'Run analysis'}
        </button>
      </div>
    </section>
  );
}
