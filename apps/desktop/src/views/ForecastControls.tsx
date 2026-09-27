import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type {
  EstimateOverrides,
  EstimationSnapshot,
  Project,
} from '../../../../packages/contracts/src/index';

interface ForecastControlsProps {
  overrides: EstimateOverrides;
  setOverrides: React.Dispatch<React.SetStateAction<EstimateOverrides>>;
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  project: Project;
  setEstimation: React.Dispatch<React.SetStateAction<EstimationSnapshot | undefined>>;
  overridesFrom: (snapshot?: EstimationSnapshot) => EstimateOverrides;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
}

/** Adjust capacity, delivery targets, and manual throughput assumptions. */
export function ForecastControls(props: ForecastControlsProps): React.JSX.Element {
  const {
    overrides,
    setOverrides,
    action,
    call,
    project,
    setEstimation,
    overridesFrom,
    setNotice,
  } = props;
  return (
    <div className="forecast-controls">
      <label>
        Manual weekly rate
        <input
          type="number"
          min="0.1"
          step="0.1"
          placeholder="Use history"
          value={overrides.manualWeeklyRate ?? ''}
          onChange={(e) =>
            setOverrides({
              ...overrides,
              manualWeeklyRate: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </label>
      <label>
        Project capacity
        <select
          value={overrides.capacityPercent}
          onChange={(e) =>
            setOverrides({
              ...overrides,
              capacityPercent: Number(e.target.value),
            })
          }
        >
          {[25, 50, 75, 100].map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
      </label>
      <label>
        Target date
        <input
          type="date"
          value={overrides.targetDate ?? ''}
          onChange={(e) => setOverrides({ ...overrides, targetDate: e.target.value || null })}
        />
      </label>
      <button
        className="secondary"
        onClick={() =>
          void action(async () => {
            const next = await call('estimateOverrides', {
              projectId: project.id,
              overrides,
            });
            setEstimation(next);
            setOverrides(overridesFrom(next));
            setNotice('Forecast settings saved.');
          })
        }
      >
        Update forecast
      </button>
    </div>
  );
}
