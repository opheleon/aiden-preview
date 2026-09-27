import { Plus } from 'lucide-react';

import type { Project } from '../../../../packages/contracts/src/index';
import brandMark from '../assets/brand-mark.svg';

interface GoalStarterProps {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  setShowGoalStarter: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Capture the initial project goal before choosing repositories. */
export function GoalStarter(props: GoalStarterProps): React.JSX.Element {
  const { project, setProject, setShowGoalStarter } = props;
  return (
    <section className="goal-starter" aria-label="Create project">
      <div className="goal-starter-brand">
        <img src={brandMark} alt="" />
        <strong>Aiden</strong>
        <span className="mono">by Opheleon</span>
      </div>
      <h1>
        What <span className="serif">project</span> should Aiden track?
      </h1>
      <p className="goal-starter-lead">
        Tell Aiden what you’re building and what it should achieve. Review the overview and
        requirements, then check them against the code.
      </p>
      <div className="chat-composer">
        <textarea
          className="chat-composer-textarea"
          aria-label="Project description"
          placeholder="Describe your project and what it should achieve…"
          maxLength={20000}
          rows={3}
          value={project.context}
          onChange={(event) => setProject({ ...project, context: event.target.value })}
        />
        <div className="chat-composer-footer">
          <select
            className="chat-model-select"
            aria-label="Model runtime"
            value={project.runtime.provider}
            onChange={(event) =>
              setProject({
                ...project,
                runtime: {
                  provider: event.target.value as 'claude' | 'codex',
                  auth: 'subscription',
                },
              })
            }
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <button
            className="primary goal-starter-create"
            disabled={!project.context.trim()}
            onClick={() => {
              setProject({
                ...project,
                name: project.name || 'New project',
              });
              setShowGoalStarter(false);
            }}
          >
            Create project <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="goal-starter-next">
        <span>
          <b>01</b> Describe the project
        </span>
        <span>
          <b>02</b> Review requirements
        </span>
        <span>
          <b>03</b> Verify against code
        </span>
      </div>
    </section>
  );
}
