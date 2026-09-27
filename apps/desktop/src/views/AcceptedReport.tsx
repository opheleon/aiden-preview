import type { JSX } from 'react';

import type { Report } from '../../../../packages/contracts/src/index';
import RequirementEstimates from '../components/RequirementEstimates';
import type { Workspace } from '../hooks/useWorkspace';
import { comparisonRange, overridesFrom } from '../renderer/project-state';
import { AssessmentResults } from './AssessmentResults';
import { EstimationPanel } from './EstimationPanel';
import { HistorySourceDialog } from './HistorySourceDialog';
import { ReportDetails } from './ReportDetails';
import { ReportSummary } from './ReportSummary';
const api = window.aiden;

/** Present an accepted report with estimates, evidence, and explicit refresh actions. */
export function AcceptedReport({
  workspace,
  report,
}: {
  workspace: Workspace;
  report: Report;
}): JSX.Element {
  const {
    project,
    setBusy,
    setLog,
    setActiveRun,
    setEvidence,
    setNotice,
    estimation,
    setEstimation,
    setOverrides,
    showHistoryConfig,
    setShowHistoryConfig,
    call,
    action,
  } = workspace;
  return (
    <>
      <ReportSummary {...workspace} report={report} api={api} estimation={estimation} />
      {estimation ? (
        <div className="product-workspace product-workspace-port">
          <RequirementEstimates
            {...workspace}
            estimation={estimation}
            report={report}
            onSave={async (nextOverrides) => {
              const next = await call('estimateOverrides', {
                projectId: project.id,
                overrides: nextOverrides,
              });
              setEstimation(next);
              setOverrides(overridesFrom(next));
              setNotice('Estimate changes saved.');
            }}
            onReestimate={() =>
              action(async () => {
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
            onConfigureHistory={() => setShowHistoryConfig(true)}
            onOpenExternal={(url) => void api?.openExternal(url)}
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
        </div>
      ) : (
        <section className="estimate-connect-panel estimation-pending">
          <p>Estimate generation has not completed for this report.</p>
        </section>
      )}
      <EstimationPanel
        {...workspace}
        report={report}
        estimation={estimation}
        overridesFrom={overridesFrom}
        comparisonRange={comparisonRange}
        api={api}
      />
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
