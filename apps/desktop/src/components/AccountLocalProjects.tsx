import { CloudUpload } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';

/**
 * Projects made on this computer before signing in, or while signed out. Each one can move into
 * the team, where teammates see it and the team's machines pick up its work. Nothing moves until
 * the person chooses it; a failed sync shows its reason in the Teams screen's error line.
 */
export function AccountLocalProjects({
  projects,
  team,
  working,
  onSync,
}: {
  projects: Project[];
  team: string;
  working: boolean;
  onSync: (projectId: string) => Promise<void>;
}): JSX.Element | null {
  const [syncing, setSyncing] = useState('');
  const local = projects.filter((project) => !project.account);
  if (!local.length) return null;
  return (
    <section className="card account-local" aria-label="Projects on this Mac">
      <div className="card-label">Projects on this Mac</div>
      <p className="account-muted">
        These projects are only on this computer. Sync one to {team} to share it with your team.
      </p>
      <ul className="account-list">
        {local.map((project) => (
          <li key={project.id} className="account-row">
            <span className="account-local-name">{project.name}</span>
            <button
              disabled={working || !!syncing}
              onClick={() => {
                setSyncing(project.id);
                void onSync(project.id).finally(() => setSyncing(''));
              }}
            >
              <CloudUpload size={14} aria-hidden="true" />
              {syncing === project.id ? 'Syncing…' : `Sync to ${team}`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
