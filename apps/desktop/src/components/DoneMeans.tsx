import type { JSX } from 'react';

import type { Baseline } from '../../../../packages/contracts/src/index';
import { plural } from '../renderer/requirement-status';
import { useProjectGuide } from './ProjectGuide';

/**
 * What done means: the intent in your words and the requirements Aiden holds the work to, with
 * the edge cases it watches. Both stay editable; editing either counts as changing the intent.
 */
export function DoneMeans({
  baseline,
  context,
  busy,
}: {
  baseline: Baseline;
  context: string;
  busy: boolean;
}): JSX.Element {
  const { open } = useProjectGuide();
  const edges = baseline.product.requirements.reduce((n, r) => n + (r.edgeCases?.length ?? 0), 0);
  return (
    <details className="brief-card done-means" aria-label="Scope" open>
      <summary className="card-label">
        Scope · {plural(baseline.product.requirements.length, 'requirement')},{' '}
        {plural(edges, 'edge case')}
      </summary>
      <blockquote className="intent">
        {context}{' '}
        <button className="text-button" disabled={busy} onClick={() => open({ type: 'goal' })}>
          Edit goal
        </button>
      </blockquote>
      <>
        <p>{baseline.product.overview}</p>
        <ol className="done-means-list">
          {baseline.product.requirements.map((r) => (
            <li key={r.id}>
              <div className="project-requirement-heading">
                <span>
                  <strong>{r.id}</strong> {r.text}
                </span>
                <button
                  className="text-button"
                  aria-label={`Change ${r.id}`}
                  disabled={busy}
                  onClick={() => open({ type: 'requirement', requirementId: r.id })}
                >
                  Change
                </button>
              </div>
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
        <button className="text-button" disabled={busy} onClick={() => open({ type: 'scope' })}>
          Edit scope
        </button>
      </>
    </details>
  );
}
