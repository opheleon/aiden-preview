import { GitBranch } from 'lucide-react';
import type { JSX } from 'react';

import type { Guide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import { connectedRepositories } from './GithubRepositories';

/**
 * The Connect code step. Aiden finds the code itself in the chat: it looks up the person's GitHub
 * accounts, asks which one the project is under and which repositories matter, then copies them.
 * This card only shows what is connected so far and offers to continue without code.
 */
export function GuideCodeSetup({
  workspace,
  guide,
}: {
  workspace: Workspace;
  guide: Guide;
}): JSX.Element {
  const { project, busy } = workspace;
  const repositories = connectedRepositories(project);
  /** Continue without code; Aiden suggests delivery slices but gives no estimate. */
  async function skip(): Promise<void> {
    await guide.skip('code');
    await guide.ask("I don't have code to connect yet.");
  }
  return (
    <section className="guide-card" aria-label="Connect your code">
      {repositories.length ? (
        <ul className="project-folder-list" aria-label="GitHub repositories">
          {repositories.map((name) => (
            <li key={name} className="project-folder">
              <GitBranch size={16} aria-hidden="true" />
              <span className="project-folder-text">
                <strong>{name}</strong>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="guide-card-note">
          Answer in the chat and Aiden finds the repositories on GitHub for you.
        </p>
      )}
      {!repositories.length && (
        <div className="guide-card-actions">
          <button disabled={busy || guide.thinking} onClick={() => void skip()}>
            No code yet
          </button>
        </div>
      )}
    </section>
  );
}
