import { type JSX, useState } from 'react';

import type { Guide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import { connectedRepositories, GithubRepositories } from './GithubRepositories';

/**
 * The Connect code step: paste the GitHub repositories for the project so Aiden can read the code
 * and size the work, or say there is no code to connect. Aiden clones each one read-only, keeps
 * the agreed requirements, and starts a code check that estimates the work when it finishes.
 */
export function GuideCodeSetup({
  workspace,
  guide,
}: {
  workspace: Workspace;
  guide: Guide;
}): JSX.Element {
  const { project, busy } = workspace;
  const [repositories, setRepositories] = useState(() => connectedRepositories(project));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  /** Clone or refresh the repositories, follow the check that reads them, and tell Aiden. */
  async function save(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const result = await workspace.call('connectCode', { projectId: project.id, repositories });
      workspace.setProject((current) =>
        current.id === project.id ? { ...current, repositories: result.repositories } : current,
      );
      workspace.setProjects(await workspace.call('projects'));
      if (result.runId) {
        workspace.setBusy(true);
        workspace.setLive('Reading your code…');
        workspace.setActiveRun(result.runId);
      }
      await guide.ask(`I connected ${repositories.join(', ')} from GitHub.`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not connect the code. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }
  /** Continue without code; Aiden suggests delivery slices but gives no estimate. */
  async function skip(): Promise<void> {
    await guide.skip('code');
    await guide.ask("I don't have code to connect yet.");
  }
  return (
    <section className="guide-card" aria-label="Connect your code">
      <p>
        Paste the GitHub repositories for this project, such as a web app and an API. Aiden keeps
        its own read-only copy of each, explores the code to size the work, and estimates how long
        it will take.
      </p>
      <GithubRepositories
        value={repositories}
        onChange={setRepositories}
        disabled={busy || saving}
      />
      {saving && (
        <p className="guide-card-note" role="status">
          Copying the repositories. A large one can take a few minutes.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="guide-card-actions">
        <button
          className="primary"
          disabled={!repositories.length || busy || saving}
          onClick={() => void save()}
        >
          {saving ? 'Connecting…' : 'Use these repositories'}
        </button>
        <button disabled={busy || saving} onClick={() => void skip()}>
          No code yet
        </button>
      </div>
    </section>
  );
}
