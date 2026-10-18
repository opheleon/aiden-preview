import type { JSX } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
import type { Check } from '../renderer/requirement-status';

/** Show web/API evidence directly when a project has no code assessment to attach it to. */
export function AppCheckResults({
  check,
  onWatch,
}: {
  check: Check;
  onWatch: (criterion: CriterionResult) => void;
}): JSX.Element {
  const labels = { pass: 'Passed', fail: 'Failed', unverified: 'Could not verify' };
  return (
    <section className="card" aria-label="App check results">
      <h2>App check results</h2>
      <p>{check.result.summary.line}</p>
      <ul className="guide-requirements">
        {check.result.criteria.map((criterion) => (
          <li key={`${criterion.requirementId}:${criterion.edgeCaseId ?? ''}`}>
            <b>
              {criterion.requirementId}
              {criterion.edgeCaseId ? ` · ${criterion.edgeCaseId}` : ''}:{' '}
              {labels[criterion.verdict]}
            </b>
            <p>{criterion.criterion}</p>
            <button onClick={() => onWatch(criterion)}>
              View evidence for {criterion.requirementId}
              {criterion.edgeCaseId ? ` ${criterion.edgeCaseId}` : ''}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
