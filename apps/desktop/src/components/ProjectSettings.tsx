import { type JSX, useState } from 'react';

import { experimentalIntegration } from '../../../../packages/contracts/src/tracker-connections';
import type { Workspace } from '../hooks/useWorkspace';
import { RepositorySetup } from '../views/RepositorySetup';
import { BetaSchedule } from './BetaSchedule';
import { BranchMonitoring } from './BranchMonitoring';
import { useProjectGuide } from './ProjectGuide';
import { TicketSettings } from './TicketSettings';

/** Choose which connected tools Aiden may read for context about this project. */
function ContextSources({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const { project, integrations, call, action, setNotice, setProject } = workspace;
  const [selected, setSelected] = useState(project.sources?.contextConnectionIds ?? []);
  const available = integrations.filter(
    (connection) =>
      !experimentalIntegration(connection) ||
      project.sources?.contextConnectionIds.includes(connection.id),
  );
  if (!available.length) return null;
  return (
    <section className="card settings-panel" aria-label="Context connections">
      <h2>Context connections</h2>
      <p>Aiden reads these, with the read tools you approved, to understand the project.</p>
      {available.map((connection) => (
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
          {experimentalIntegration(connection) ? ' · Experimental' : ''}
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
  const { project, projects, busy, start } = workspace;
  const { open } = useProjectGuide();
  const saved = projects.find((p) => p.id === project.id);
  if (!saved) return <p className="fine-print">Hand a project to Aiden first.</p>;
  return (
    <div className="settings-stack">
      <section className="settings-stack" aria-label="Testing settings">
        <h2>Testing settings</h2>
        <BranchMonitoring workspace={workspace} />
        <section className="card settings-panel" aria-label="Project verification">
          <h2>App and API access</h2>
          <p>Check and update this project’s test access in its conversation.</p>
          <button disabled={busy} onClick={() => open({ type: 'verification' })}>
            Edit verification in chat
          </button>
        </section>
      </section>
      <RepositorySetup {...workspace} />
      <div className="next-row">
        <span>Saving the folder makes Aiden rewrite the requirements and run a check.</span>
        <button className="primary" disabled={busy} onClick={() => void start()}>
          Save and run check
        </button>
      </div>
      <TicketSettings key={`tickets-${project.id}`} workspace={workspace} />
      <BetaSchedule key={`beta-${project.id}`} workspace={workspace} />
      <ContextSources key={`sources-${project.id}`} workspace={workspace} />
    </div>
  );
}
