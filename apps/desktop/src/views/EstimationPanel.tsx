import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type {
  EstimateOverrides,
  EstimationSnapshot,
  Project,
  Report,
} from '../../../../packages/contracts/src/index';
import { defaultOverrides, isHistoryStale } from '../../../../packages/estimation/src/index';
import type { DesktopBridge } from '../bridge';
import { ForecastControls } from '../views/ForecastControls';
import { RequirementEstimateRow } from '../views/RequirementEstimateRow';

interface EstimationPanelProps {
  action: (fn: () => Promise<void>) => Promise<void>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setLog: React.Dispatch<React.SetStateAction<string[]>>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  project: Project;
  report: Report;
  setActiveRun: React.Dispatch<React.SetStateAction<string>>;
  estimation: EstimationSnapshot | undefined;
  overrides: EstimateOverrides;
  setOverrides: React.Dispatch<React.SetStateAction<EstimateOverrides>>;
  setEstimation: React.Dispatch<React.SetStateAction<EstimationSnapshot | undefined>>;
  overridesFrom: (snapshot?: EstimationSnapshot) => EstimateOverrides;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  comparisonRange: (snapshot: EstimationSnapshot, ids: string[]) => string | null;
  api: DesktopBridge | undefined;
}

/** Review original and remaining work estimates alongside forecast assumptions. */
export function EstimationPanel(props: EstimationPanelProps): React.JSX.Element {
  const {
    action,
    setBusy,
    setLog,
    call,
    project,
    report,
    setActiveRun,
    estimation,
    overrides,
    setOverrides,
    setEstimation,
    overridesFrom,
    setNotice,
    comparisonRange,
    api,
  } = props;
  return (
    <section className="card estimation-panel legacy-report-panel">
      <div className="card-heading">
        <div className="section-icon">
          <BarChart3 size={19} />
        </div>
        <div>
          <h2>Scope & forecast</h2>
          <p>Original complexity and independently estimated remaining work.</p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            void action(async () => {
              setBusy(true);
              setLog(['Refreshing estimation and history…']);
              const result = await call('estimate', {
                projectId: project.id,
                reportId: report.id,
                refreshHistory: true,
              });
              setActiveRun(result.runId);
            })
          }
        >
          <RefreshCw size={13} />{' '}
          {estimation && isHistoryStale(estimation) ? 'Re-estimate · history stale' : 'Re-estimate'}
        </button>
      </div>
      {estimation ? (
        <>
          <ForecastSummary estimation={estimation} />
          <ForecastControls
            overrides={overrides}
            setOverrides={setOverrides}
            action={action}
            call={call}
            project={project}
            setEstimation={setEstimation}
            overridesFrom={overridesFrom}
            setNotice={setNotice}
          />
          <div className="estimate-rows">
            {estimation.requirements.map((row) => (
              <RequirementEstimateRow
                key={row.requirementId}
                row={row}
                report={report}
                overrides={overrides}
                setOverrides={setOverrides}
                comparisonRange={comparisonRange}
                estimation={estimation}
                api={api}
              />
            ))}
          </div>
          <div className="estimate-actions">
            <button
              className="secondary"
              onClick={() => {
                const reset = defaultOverrides();
                setOverrides({
                  ...reset,
                  capacityPercent: overrides.capacityPercent,
                  manualWeeklyRate: overrides.manualWeeklyRate,
                  targetDate: overrides.targetDate,
                });
              }}
            >
              Reset to suggestions
            </button>
            <button
              className="primary"
              onClick={() =>
                void action(async () => {
                  const next = await call('estimateOverrides', {
                    projectId: project.id,
                    overrides,
                  });
                  setEstimation(next);
                  setOverrides(overridesFrom(next));
                  setNotice('Estimate overrides saved.');
                })
              }
            >
              Save estimates
            </button>
          </div>
          {estimation.historyLimitations.map((limitation) => (
            <p className="estimate-limitation" key={limitation}>
              <AlertTriangle size={13} /> {limitation}
            </p>
          ))}
        </>
      ) : (
        <div className="empty-inline">
          <p>Estimate generation has not completed for this report.</p>
        </div>
      )}
    </section>
  );
}

/** Summarize scope, velocity-derived finish date, and target variance with explicit unknown values. */
function ForecastSummary({ estimation }: { estimation: EstimationSnapshot }): React.JSX.Element {
  return (
    <div className="forecast-grid">
      <div>
        <span>Implemented scope</span>
        <strong>
          {estimation.forecast.implementedPercent === null
            ? 'Unknown'
            : `${estimation.forecast.implementedPercent}%`}
        </strong>
        <small>
          {estimation.forecast.implementedPoints} of {estimation.forecast.totalPoints} points
        </small>
      </div>
      <div>
        <span>Remaining work</span>
        <strong>{estimation.forecast.remainingPoints ?? 'Unknown'}</strong>
        <small>independently estimated points</small>
      </div>
      <div>
        <span>Forecast finish</span>
        <strong>{estimation.forecast.forecastFinish ?? 'Unavailable'}</strong>
        <small>
          {estimation.forecast.remainingWorkingDays === null
            ? 'Add a weekly rate'
            : `${estimation.forecast.remainingWorkingDays} working days`}
        </small>
      </div>
      <div>
        <span>Target variance</span>
        <strong>
          {estimation.forecast.targetVarianceWorkingDays === null
            ? 'Unavailable'
            : `${estimation.forecast.targetVarianceWorkingDays > 0 ? '+' : ''}${estimation.forecast.targetVarianceWorkingDays}d`}
        </strong>
        <small>weekends excluded</small>
      </div>
    </div>
  );
}
