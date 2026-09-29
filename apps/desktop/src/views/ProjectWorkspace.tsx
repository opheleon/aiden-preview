import { Activity, ArrowRight } from 'lucide-react';
import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import { AcceptedReport } from './AcceptedReport';
import { ContextSetup } from './ContextSetup';
import { GoalStarter } from './GoalStarter';
import { ProjectNavigation } from './ProjectNavigation';
import { RepositorySetup } from './RepositorySetup';
import { RequirementReview } from './RequirementReview';
import { RunHistory } from './RunHistory';
import { RunProgress } from './RunProgress';
import { WorkspaceFeedback } from './WorkspaceFeedback';
const api = window.aiden;

/** Route setup, review, progress, and accepted artifacts within the selected project. */
export function ProjectWorkspace({
  workspace,
  runtimeControls,
  terminalRuns,
}: {
  workspace: Workspace;
  runtimeControls: JSX.Element;
  terminalRuns: Workspace['runs'];
}): JSX.Element {
  const { step, busy, product, baseline, report, showGoalStarter } = workspace;
  return (
    <>
      <div className={showGoalStarter ? 'content starter-content' : 'content'}>
        <ProjectNavigation workspace={workspace} />
        {showGoalStarter && <GoalStarter {...workspace} />}
        <WorkspaceFeedback workspace={workspace} />
        <WorkspaceSetup workspace={workspace} runtimeControls={runtimeControls} />
        {step === 1 && <ContextSetup {...workspace} api={api} />}
        {step === 2 && product && (
          <RequirementReview {...workspace} product={product} baseline={baseline} />
        )}
        {busy && <RunProgress {...workspace} />}
        {/* The last accepted report stays readable while a new run is in progress. */}
        {step === 3 && report && <AcceptedReport workspace={workspace} report={report} />}
        <EmptyReport workspace={workspace} />
        {(step === 3 || !baseline) && terminalRuns.length > 0 && (
          <RunHistory {...workspace} terminalRuns={terminalRuns} />
        )}
      </div>
    </>
  );
}

/** Gate repository setup before proceeding to context entry. */
function WorkspaceSetup({
  workspace,
  runtimeControls,
}: {
  workspace: Workspace;
  runtimeControls: JSX.Element;
}): JSX.Element {
  const { showGoalStarter, step, busy, scanning, project, setStep } = workspace;
  return (
    <>
      {!showGoalStarter && step === 0 && (
        <div className="setup-grid">
          <div>
            <RepositorySetup {...workspace} />
            <div className="next-row">
              <span>Your repositories. Your model provider.</span>
              <button
                className="primary"
                disabled={busy || scanning || !project.name.trim() || !project.repositories.length}
                onClick={() => setStep(1)}
              >
                Add project context <ArrowRight size={16} />
              </button>
            </div>
          </div>
          {runtimeControls}
        </div>
      )}
    </>
  );
}

/** Offer an explicit first analysis only after the baseline has been reviewed. */
function EmptyReport({ workspace }: { workspace: Workspace }): JSX.Element {
  const { step, busy, report, baseline, analyze } = workspace;
  return (
    <>
      {step === 3 && !busy && !report && (
        <section className="card empty">
          <Activity size={30} />
          <h2>Ready for a first look.</h2>
          <p>
            {baseline
              ? 'Run Aiden against your reviewed requirements to generate a project report.'
              : 'Prepare and review the project requirements first.'}
          </p>
          {baseline && (
            <button className="primary" onClick={() => void analyze()}>
              Run analysis <ArrowRight size={16} />
            </button>
          )}
        </section>
      )}
    </>
  );
}
