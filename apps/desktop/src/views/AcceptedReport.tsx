import type { JSX } from 'react';

import type { Report } from '../../../../packages/contracts/src/index';
import RequirementEstimates from '../components/RequirementEstimates';
import RequirementStatus from '../components/RequirementStatus';
import type { Workspace } from '../hooks/useWorkspace';
import { overridesFrom } from '../renderer/project-state';
import { AssessmentResults } from './AssessmentResults';
import { HistorySourceDialog } from './HistorySourceDialog';
import { ReportDetails } from './ReportDetails';
import { ReportSummary } from './ReportSummary';
const api = window.aiden;

/**
 * Present an accepted report: requirement status first (code assessment plus browser check, with
 * recordings), then remaining work estimates, collapsed so they stay secondary.
 */
export function AcceptedReport({
  workspace,
  report,
}: {
  workspace: Workspace;
  report: Report;
}): JSX.Element {
  const { project, busy, setEvidence, estimation, verification, showHistoryConfig, call, action } =
    workspace;
  return (
    <>
      <ReportSummary {...workspace} report={report} api={api} estimation={estimation} />
      <div className="product-workspace product-workspace-port">
        <RequirementStatus
          report={report}
          verification={verification}
          projectId={project.id}
          api={api}
          onOpenEvidence={(assessmentIndex, evidenceIndex) =>
            void action(async () =>
              setEvidence(
                await call('evidence', {
                  projectId: project.id,
                  runId: report.id,
                  index: assessmentIndex,
                  evidenceIndex,
                }),
              ),
            )
          }
        />
        <details className="estimates-section">
          <summary>Estimates</summary>
          {estimation ? (
            <Estimates workspace={workspace} report={report} />
          ) : (
            <section className="estimate-connect-panel estimation-pending">
              <p>
                Estimates size the remaining work for each requirement and, with ticket history,
                suggest a time range. They are optional and do not change the status above.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void workspace.estimate(report.id)}
              >
                Estimate remaining work
              </button>
            </section>
          )}
        </details>
      </div>
      {showHistoryConfig && (
        <div className="modal-overlay">
          <HistorySourceDialog {...workspace} />
        </div>
      )}
      <AssessmentResults {...workspace} report={report} />
      <ReportDetails report={report} />
    </>
  );
}

/** Remaining work estimates for this report, with saved overrides and a history refresh. */
function Estimates({ workspace, report }: { workspace: Workspace; report: Report }): JSX.Element {
  const { project, estimation, setEstimation, setOverrides, setNotice, setShowHistoryConfig } =
    workspace;
  if (!estimation) return <></>;
  return (
    <>
      {estimation.reportId !== report.id && (
        <p className="estimate-footnote">
          These estimates come from an earlier code assessment. Re-estimate to size the work left
          after the latest one.
        </p>
      )}
      <RequirementEstimates
        {...workspace}
        estimation={estimation}
        report={report}
        onSave={async (nextOverrides) => {
          const next = await workspace.call('estimateOverrides', {
            projectId: project.id,
            overrides: nextOverrides,
          });
          setEstimation(next);
          setOverrides(overridesFrom(next));
          setNotice('Estimate changes saved.');
        }}
        onReestimate={() => workspace.estimate(report.id, true)}
        onConfigureHistory={() => setShowHistoryConfig(true)}
        onOpenExternal={(url) => void api?.openExternal(url)}
      />
    </>
  );
}
