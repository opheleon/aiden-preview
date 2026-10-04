import { type JSX, useState } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import { RepositorySetup } from '../views/RepositorySetup';
import { ApiVerificationSettings } from './ApiVerificationSettings';
import { BetaSchedule } from './BetaSchedule';
import { BranchMonitoring } from './BranchMonitoring';
import { TicketSettings } from './TicketSettings';
import VerificationSettings from './VerificationSettings';
const api = window.aiden;

/** Choose which connected tools Aiden may read for context about this project. */
function ContextSources({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const { project, integrations, call, action, setNotice, setProject } = workspace;
  const [selected, setSelected] = useState(project.sources?.contextConnectionIds ?? []);
  if (!integrations.length) return null;
  return (
    <section className="card settings-panel" aria-label="Context connections">
      <h2>Context connections</h2>
      <p>Aiden reads these, with the read tools you approved, to understand the project.</p>
      {integrations.map((connection) => (
        <label className="checkbox-row" key={connection.id}>
          <input
            type="checkbox"
            checked={selected.includes(connection.id)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...new Set([...selected, connection.id])]
                  : selected.filter((id) => id !== connection.id),
              )
            }
          />
          {connection.name}
        </label>
      ))}
      <button
        className="secondary"
        onClick={() =>
          void action(async () => {
            const sources = {
              contextConnectionIds: selected,
              history: project.sources?.history ?? null,
            };
            await call('updateSources', { projectId: project.id, sources });
            setProject((p) => ({ ...p, sources }));
            setNotice('Context connections saved. Aiden uses them on its next look.');
          })
        }
      >
        Save connections
      </button>
    </section>
  );
}

/**
 * Everything specific to one project: its folder, where its app runs, and the tools Aiden may
 * read for context. Changing the folder changes what Aiden looks at, so it looks again.
 */
export function ProjectSettings({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, projects, busy, start, verification, lookNow } = workspace;
  const saved = projects.find((p) => p.id === project.id);
  if (!saved) return <p className="fine-print">Hand a project to Aiden first.</p>;
  return (
    <div className="settings-stack">
      <BranchMonitoring workspace={workspace} />
      <RepositorySetup {...workspace} />
      <div className="next-row">
        <span>Saving the folder makes Aiden rewrite the requirements and run a check.</span>
        <button
          className="primary"
          disabled={busy || !project.repositories.length}
          onClick={() => void start()}
        >
          Save and run check
        </button>
      </div>
      <VerificationSettings key={project.id} project={project} api={api} latest={verification} />
      <ApiVerificationSettings key={`api-${project.id}`} projectId={project.id} api={api} />
      <TicketSettings key={`tickets-${project.id}`} workspace={workspace} />
      <BetaSchedule key={`beta-${project.id}`} workspace={workspace} />
      <button disabled={busy} onClick={() => void lookNow()}>
        Run check now
      </button>
      <ContextSources key={`sources-${project.id}`} workspace={workspace} />
    </div>
  );
}
