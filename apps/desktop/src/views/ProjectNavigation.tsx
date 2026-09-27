import { Check, ChevronRight, FolderKanban } from 'lucide-react';
import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import { ProjectHeader } from './ProjectHeader';
const api = window.aiden;
const steps = ['Workspace', 'Project context', 'Requirements', 'Report'];

/** Present the current setup step and guard navigation until its required artifacts exist. */
export function ProjectNavigation({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, step, setStep, busy, product, baseline, report, estimation, showGoalStarter } =
    workspace;
  return (
    <>
      {!showGoalStarter && (
        <div className={step === 3 ? 'project-breadcrumb' : 'breadcrumb'}>
          {step === 3 ? <FolderKanban size={15} aria-hidden="true" /> : null}
          Projects {step === 3 ? <span>/</span> : <ChevronRight size={13} />}
          <strong>{step === 3 ? 'Overview' : project.name || 'New project'}</strong>
        </div>
      )}
      {!showGoalStarter && (
        <ProjectHeader
          {...workspace}
          report={report}
          baseline={baseline}
          api={api}
          estimation={estimation}
        />
      )}
      {!showGoalStarter && step !== 3 && (
        <div className="steps">
          {steps.map((s, i) => (
            <button
              key={s}
              disabled={busy || (i === 2 && !product) || (i === 3 && !baseline && !report)}
              onClick={() => setStep(i)}
              className={step === i ? 'current' : ''}
              aria-current={step === i ? 'step' : undefined}
            >
              <span>{i < step ? <Check size={12} /> : i + 1}</span>
              {s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
