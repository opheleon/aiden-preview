import { type JSX, useState } from 'react';

import type {
  EstimateOverrides,
  EstimationSnapshot,
  Forecast,
  Report,
} from '../../../../packages/contracts/src/index';

/** Format a calendar-only forecast date without shifting it across a local midnight. */
const formatDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

interface ProjectHealthProps {
  estimation: EstimationSnapshot;
  report: Report;
  overrides: EstimateOverrides;
  onSave: (next: EstimateOverrides) => Promise<void>;
  busy: boolean;
}
/** Summarize accepted scope and forecast assumptions, with explicit editing of delivery capacity. */
export default function ProjectHealth({
  estimation,
  report,
  overrides,
  onSave,
  busy,
}: ProjectHealthProps): JSX.Element {
  const health = estimation.forecast;
  const [open, setOpen] = useState(false);
  const deviations = report.deviations.length;
  /** Open a fresh editor initialized from the currently accepted overrides. */
  const edit = () => setOpen(true);
  return (
    <section className="project-health" aria-label="Project health">
      <div className="project-health-heading">
        <h2>Project health</h2>
        <span>Based on code assessment</span>
      </div>
      <HealthMetrics health={health} deviations={deviations} busy={busy} edit={edit} />
      <div className="project-health-assumptions">
        <button disabled={busy} onClick={edit}>
          {health.weeklyRate
            ? `Expected delivery: ${health.weeklyRate.toFixed(1)} points/week · ${health.rateSource === 'manual' ? 'manual' : 'team history'}`
            : 'Set delivery rate'}{' '}
          <span>✎</span>
        </button>
        <button disabled={busy} onClick={edit}>
          {health.targetDate ? `Target: ${formatDate(health.targetDate)}` : 'Add target date'}{' '}
          <span>✎</span>
        </button>
      </div>
      <HealthInsight health={health} report={report} deviations={deviations} />
      <details className="project-health-method">
        <summary>About this forecast</summary>
        <p>
          Progress weights implemented requirements by their original scope sizes, including manual
          sizes. Remaining scope is estimated separately from saved code evidence and includes
          corrections for deviations. Code assessment does not confirm deployment or passing tests.
        </p>
        <p>
          Forecasts start from the saved reference date, count full Monday–Friday working days,
          round up, and skip weekends. Holidays are not excluded. The rate assumes capacity
          available to this project. Individual requirement durations are not added together.
        </p>
        <p>
          The suggested rate uses completed points over the 90 calendar days ending at the history
          snapshot, including quiet weeks. Project capacity scales the team rate; a manual rate
          already represents this project. At least three dated issues and complete fetched history
          are required.
        </p>
        {estimation.historyCollectedAt && (
          <p>History collected {new Date(estimation.historyCollectedAt).toLocaleDateString()}.</p>
        )}
      </details>
      {open && (
        <ForecastEditor
          estimation={estimation}
          overrides={overrides}
          onSave={onSave}
          busy={busy}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** Show weighted progress, remaining scope, finish date, and deviations from the accepted report. */
function HealthMetrics({
  health,
  deviations,
  busy,
  edit,
}: {
  health: Forecast;
  deviations: number;
  busy: boolean;
  edit: () => void;
}): JSX.Element {
  const unknown = !health.completeCoverage
    ? 'Refresh status to assess scope'
    : health.remainingPoints === null
      ? 'Estimate remaining work from the latest assessment'
      : 'Preparing project summary';
  return (
    <div className="project-health-metrics">
      <div className="project-health-metric">
        <h3>Scope implemented</h3>
        <strong>
          {health.implementedPercent === null ? 'Not assessed' : `${health.implementedPercent}%`}
        </strong>
        <p>
          {health.implementedPercent === null
            ? unknown
            : `${health.implementedPoints} of ${health.totalPoints} complexity points`}
        </p>
        {health.implementedPercent !== null && (
          <progress aria-label="Scope implemented" max="100" value={health.implementedPercent} />
        )}
      </div>
      <div className="project-health-metric">
        <h3>Remaining scope</h3>
        <strong>
          {health.remainingPoints === null ? (
            'Unknown'
          ) : (
            <>
              {health.remainingPoints} <small>points</small>
            </>
          )}
        </strong>
        <p>
          {health.remainingPoints === null ? unknown : 'Remaining changes, including corrections'}
        </p>
      </div>
      <ForecastMetric health={health} unknown={unknown} busy={busy} edit={edit} />
      <div className="project-health-metric">
        <h3>Scope deviations</h3>
        <strong>{deviations}</strong>
        <p>
          {deviations ? 'Requirements differ from agreed scope' : 'None found in assessed code'}
        </p>
      </div>
    </div>
  );
}
/** Explain the summary with the report timestamp and the assumptions behind its finish date. */
function HealthInsight({
  health,
  report,
  deviations,
}: {
  health: Forecast;
  report: Report;
  deviations: number;
}): JSX.Element {
  return (
    <p className="project-health-insight">
      {health.implementedPercent === null
        ? 'Assess and size the full scope to see weighted progress and a finish forecast.'
        : `${health.implementedPercent}% of scope is implemented. ${deviations ? `${deviations} requirement${deviations === 1 ? ' still differs' : 's still differ'} from the agreed scope.` : 'No scope deviations were found.'}`}
      {health.forecastFinish &&
        ` At ${health.weeklyRate?.toFixed(1)} points/week, the remaining scope would take ${health.remainingWorkingDays} working days.`}
      <span> Last assessed {new Date(report.generatedAt).toLocaleString()}.</span>
    </p>
  );
}
/** Edit a fresh copy of forecast overrides, keeping failed saves visible and cancellable. */
function ForecastEditor({
  estimation,
  overrides,
  onSave,
  busy,
  onClose,
}: Omit<ProjectHealthProps, 'report'> & { onClose: () => void }): JSX.Element {
  const [rate, setRate] = useState<string | number>(overrides.manualWeeklyRate ?? '');
  const [target, setTarget] = useState(overrides.targetDate ?? '');
  const [capacity, setCapacity] = useState(overrides.capacityPercent);
  const [error, setError] = useState('');
  /** Persist explicit forecast overrides; failed writes leave the editor open for retry. */
  const save = async (manualWeeklyRate: number | null) => {
    setError('');
    try {
      await onSave({
        ...overrides,
        manualWeeklyRate,
        capacityPercent: Number(capacity),
        targetDate: target || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the forecast.');
    }
  };
  return (
    <div className="modal-overlay">
      <section
        className="product-workspace estimate-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Project forecast"
      >
        <header>
          <h2>Project forecast</h2>
          <p>Set the delivery capacity available to this project. Weekends are always excluded.</p>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(rate === '' ? null : Number(rate));
          }}
        >
          <label className="estimate-days-input">
            Expected points per week
            <input
              aria-label="Expected points per week"
              type="number"
              min="0.1"
              max="10000"
              step="any"
              placeholder="e.g. 6"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
          <label className="estimate-days-input">
            Team capacity for this project (%)
            <input
              aria-label="Team capacity for this project"
              type="number"
              min="0.1"
              max="100"
              step="any"
              required
              value={capacity}
              onChange={(event) => setCapacity(Number(event.target.value))}
            />
          </label>
          <p className="product-muted">
            Applies when using team history. A manual weekly rate already includes project capacity.
          </p>
          <p className="product-muted">
            {estimation.historyComplete && estimation.history.length >= 3
              ? `Team history includes ${estimation.history.length} completed issues over 90 days. Leave the rate blank to use it.`
              : 'No usable team rate yet. Re-estimate with a history connection, or enter a manual rate.'}
          </p>
          <label className="estimate-days-input">
            Target date (optional)
            <input
              aria-label="Target date"
              type="date"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <div className="product-actions">
            <button className="primary" disabled={busy}>
              Save forecast
            </button>
            {overrides.manualWeeklyRate && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void save(null)}
              >
                Use team rate
              </button>
            )}
            <button type="button" className="secondary" onClick={() => onClose()}>
              Cancel
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="product-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

/** Present the finish estimate and target variance while keeping unknown scope explicit. */
function ForecastMetric({
  health,
  unknown,
  busy,
  edit,
}: {
  health: Forecast;
  unknown: string;
  busy: boolean;
  edit: () => void;
}): JSX.Element {
  const variance =
    health.targetVarianceWorkingDays === null
      ? null
      : health.targetVarianceWorkingDays === 0
        ? 'On target'
        : `${Math.abs(health.targetVarianceWorkingDays)} working ${Math.abs(health.targetVarianceWorkingDays) === 1 ? 'day' : 'days'} ${health.targetVarianceWorkingDays > 0 ? 'after' : 'before'} target`;
  return (
    <button
      className="project-health-metric project-health-edit"
      aria-label="Edit forecast"
      disabled={busy}
      onClick={edit}
    >
      <h3>
        Forecast finish <span>↗</span>
      </h3>
      <strong>
        {health.remainingPoints === 0
          ? 'Implemented'
          : health.forecastFinish
            ? formatDate(health.forecastFinish)
            : 'Unknown'}
      </strong>
      <p>
        {health.remainingPoints === 0
          ? 'No implementation scope remaining'
          : health.forecastFinish
            ? `${health.remainingWorkingDays} working days · Mon–Fri`
            : health.remainingPoints === null
              ? unknown
              : 'Set delivery rate to forecast'}
      </p>
      {variance && (
        <span
          className={
            health.targetVarianceWorkingDays! > 0 ? 'project-health-late' : 'product-muted'
          }
        >
          {variance}
        </span>
      )}
    </button>
  );
}
