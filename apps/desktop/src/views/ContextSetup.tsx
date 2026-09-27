import { ArrowLeft, ArrowRight, FileText, Plus } from 'lucide-react';

import type { Project } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

interface ContextSetupProps {
  action: (fn: () => Promise<void>) => Promise<void>;
  api: DesktopBridge | undefined;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  project: Project;
  busy: boolean;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  prepare: () => Promise<void>;
}

/** Capture product context before requesting requirement extraction. */
export function ContextSetup(props: ContextSetupProps): React.JSX.Element {
  const { action, api, setProject, project, busy, setStep, prepare } = props;
  return (
    <section className="card context-card">
      <div className="card-heading">
        <div className="section-icon">
          <FileText size={19} />
        </div>
        <div>
          <h2>Project intent</h2>
          <p>A PRD, a brief, or a few clear sentences about the outcome.</p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            void action(async () => {
              const text = await api?.chooseContext();
              if (text)
                setProject({
                  ...project,
                  context: project.context ? project.context + '\n\n' + text : text,
                });
            })
          }
        >
          <Plus size={14} /> Import file
        </button>
      </div>
      <textarea
        aria-label="Project context"
        className="context"
        placeholder="What should this project do?\n\nInclude agreed requirements, constraints, and any milestones. Aiden will ask if something essential is unclear."
        value={project.context}
        onChange={(e) => setProject({ ...project, context: e.target.value })}
        disabled={busy}
      />
      <div className="next-row">
        <button className="text-button" disabled={busy} onClick={() => setStep(0)}>
          <ArrowLeft size={14} /> Workspace
        </button>
        <button
          className="primary"
          disabled={busy || !project.context.trim()}
          onClick={() => void prepare()}
        >
          {busy ? 'Understanding project…' : 'Prepare requirements'}
          <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
