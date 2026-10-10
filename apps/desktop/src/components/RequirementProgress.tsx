import type { JSX } from 'react';

import type { ItemState } from '../renderer/requirement-status';

/** Requirement counts behind the overall bar: verified work and work built but not yet checked. */
export interface RequirementCounts {
  total: number;
  /** Done: checked in the app or API, checked in code when nothing is visible, or confirmed by you. */
  done: number;
  /** Built in the code, waiting for a check to confirm it. */
  built: number;
}

/** Count done and built requirements from their displayed states. */
export function requirementCounts(
  states: Map<string, ItemState>,
  total: number,
): RequirementCounts {
  const values = [...states.values()];
  return {
    total,
    done: values.filter((s) => s.label === 'Done').length,
    built: values.filter((s) => s.label === 'Built').length,
  };
}

/**
 * The overall progress line and a two-tone bar: green for requirements done and verified, blue for
 * requirements built in the code that no check has confirmed yet. Example: "3 of 15 requirements
 * complete · 5 built, not yet verified". The bar counts requirements, not effort. Screen readers
 * get the native progress element and the visible text; the colored bar is decorative.
 */
export function RequirementProgress({ counts }: { counts: RequirementCounts }): JSX.Element {
  const { total, done, built } = counts;
  /** Width of a bar segment as a share of all requirements. */
  const share = (n: number) => `${total ? (100 * n) / total : 0}%`;
  return (
    <>
      <div className="progress-heading">
        <h2 className="card-label">Overall progress</h2>
        <p className="brief-status">
          <strong>
            {done} of {total} requirements complete
          </strong>
          {built > 0 && <span className="progress-built"> · {built} built, not yet verified</span>}
        </p>
      </div>
      <div className="requirement-progress" aria-hidden="true">
        <span className="requirement-progress-done" style={{ width: share(done) }} />
        <span className="requirement-progress-built" style={{ width: share(built) }} />
      </div>
      <progress
        className="requirement-progress-value"
        aria-label="Requirements complete, not percentage of effort"
        max={total}
        value={done}
      />
    </>
  );
}
