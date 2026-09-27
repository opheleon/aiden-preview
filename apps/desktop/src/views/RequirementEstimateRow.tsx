import { ExternalLink } from 'lucide-react';
import React from 'react';

import type {
  EstimateOverrides,
  EstimationSnapshot,
  Report,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

interface RequirementEstimateRowProps {
  row: EstimationSnapshot['requirements'][number];
  report: Report;
  overrides: EstimateOverrides;
  setOverrides: React.Dispatch<React.SetStateAction<EstimateOverrides>>;
  comparisonRange: (snapshot: EstimationSnapshot, ids: string[]) => string | null;
  estimation: EstimationSnapshot;
  api: DesktopBridge | undefined;
}

/** Display one original/remaining estimate and its manual overrides. */
export function RequirementEstimateRow(props: RequirementEstimateRowProps): React.JSX.Element {
  const { row, report, overrides, setOverrides, comparisonRange, estimation, api } = props;
  return (
    <div key={row.requirementId} className="estimate-row">
      <div>
        <span className="req-id">{row.requirementId}</span>
        <strong>
          {
            report.baseline.requirements.find((requirement) => requirement.id === row.requirementId)
              ?.text
          }
        </strong>
        <small>{row.original.reasoning}</small>
      </div>
      <label>
        Original
        <select
          value={overrides.requirementPoints[row.requirementId] ?? row.suggestedPoints}
          onChange={(e) =>
            setOverrides({
              ...overrides,
              requirementPoints: {
                ...overrides.requirementPoints,
                [row.requirementId]: Number(e.target.value),
              },
            })
          }
        >
          {[1, 2, 3, 5, 8].map((value) => (
            <option key={value} value={value}>
              {value} pts
            </option>
          ))}
        </select>
      </label>
      <label>
        Remaining
        <select
          disabled={row.suggestedRemainingPoints === null}
          value={overrides.remainingPoints[row.requirementId] ?? row.suggestedRemainingPoints ?? ''}
          onChange={(e) =>
            setOverrides({
              ...overrides,
              remainingPoints: {
                ...overrides.remainingPoints,
                [row.requirementId]: Number(e.target.value),
              },
            })
          }
        >
          {[0, 1, 2, 3, 5, 8].map((value) => (
            <option key={value} value={value}>
              {value} pts
            </option>
          ))}
        </select>
      </label>
      <label className="duration-cell">
        <span>Calendar days</span>
        <input
          type="number"
          min="0"
          step="0.5"
          placeholder="Unavailable"
          value={overrides.durations[row.requirementId] ?? row.suggestedDurationDays ?? ''}
          onChange={(e) => {
            const durations = { ...overrides.durations };
            if (e.target.value) durations[row.requirementId] = Number(e.target.value);
            else delete durations[row.requirementId];
            setOverrides({ ...overrides, durations });
          }}
        />
        <small>
          {row.comparisons.length} comparisons
          {comparisonRange(estimation, row.comparisons)
            ? ` · ${comparisonRange(estimation, row.comparisons)}`
            : ''}
          {row.durationOverridden ? ' · overridden' : ''}
        </small>
      </label>
      {estimation.history.length > 0 && (
        <details className="comparison-editor">
          <summary>Choose historical comparisons</summary>
          <div>
            {estimation.history.map((issue) => {
              const selected = overrides.comparisons[row.requirementId] ?? row.comparisons;
              return (
                <div className="comparison-option" key={issue.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(issue.id)}
                      onChange={(event) => {
                        const current = new Set(
                          overrides.comparisons[row.requirementId] ?? row.comparisons,
                        );
                        if (event.target.checked) current.add(issue.id);
                        else current.delete(issue.id);
                        setOverrides({
                          ...overrides,
                          comparisons: {
                            ...overrides.comparisons,
                            [row.requirementId]: [...current],
                          },
                        });
                      }}
                    />
                    <span>
                      {issue.identifier} · {issue.title}
                    </span>
                    <small>
                      {issue.observedCalendarDays === null
                        ? 'Duration unavailable'
                        : `${issue.observedCalendarDays} days`}{' '}
                      · {issue.points ?? '?'} points
                    </small>
                  </label>
                  {issue.url && (
                    <button
                      className="icon-button"
                      aria-label={`Open ${issue.identifier}`}
                      onClick={() => void api?.openExternal(issue.url!)}
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="text-button"
            onClick={() => {
              const comparisons = { ...overrides.comparisons };
              delete comparisons[row.requirementId];
              setOverrides({ ...overrides, comparisons });
            }}
          >
            Reset comparison selection
          </button>
        </details>
      )}
    </div>
  );
}
