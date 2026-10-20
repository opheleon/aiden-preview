import { type JSX, useState } from 'react';

import { projectFolders } from '../hooks/project-folders';
import type { Guide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import { folderName, ProjectFolders } from './ProjectFolders';

/**
 * The Connect code step: add one or more code folders so Aiden can size the work, or say the code
 * is not on this computer. Saving keeps the agreed requirements and starts a code check, which
 * estimates the work when it finishes; without code, Aiden explains its best-guess plan instead.
 */
export function GuideCodeSetup({
  workspace,
  guide,
}: {
  workspace: Workspace;
  guide: Guide;
}): JSX.Element {
  const { project, busy, scanning } = workspace;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const folders = projectFolders(project);
  const repositories = project.repositories.length;
  /** Save the folders, follow the check that reads them, and tell Aiden what was connected. */
  async function save(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const { rootPath, additionalRootPaths } = project;
      const result = await workspace.call('connectCode', {
        projectId: project.id,
        code: {
          ...(rootPath ? { rootPath } : {}),
          ...(additionalRootPaths?.length ? { additionalRootPaths } : {}),
          repositories: project.repositories,
        },
      });
      workspace.setProjects(await workspace.call('projects'));
      if (result.runId) {
        workspace.setBusy(true);
        workspace.setLive('Reading your code…');
        workspace.setActiveRun(result.runId);
      }
      await guide.ask(
        `I connected ${repositories} ${repositories === 1 ? 'repository' : 'repositories'} in ${folders.map(folderName).join(', ')}.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not connect the code. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }
  /** Continue without code; Aiden explains its best guess and what code would add. */
  async function skip(): Promise<void> {
    await guide.skip('code');
    await guide.ask("I don't have the code on this computer.");
  }
  return (
    <section className="guide-card" aria-label="Connect your code">
      <p>
        Add the folders with your code. Aiden reads them to size the work and estimate how long it
        will take. You can add more than one, such as a web app and an API.
      </p>
      <ProjectFolders
        project={project}
        busy={busy || saving}
        scanning={scanning}
        onAdd={() => void workspace.addProjectFolder()}
        onRemove={workspace.removeProjectFolder}
      />
      {folders.length > 0 && !repositories && (
        <p className="guide-card-note">
          No Git repository was found in these folders. Add a folder that contains one.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="guide-card-actions">
        <button
          className="primary"
          disabled={!repositories || busy || saving || scanning}
          onClick={() => void save()}
        >
          {saving ? 'Connecting…' : 'Use these folders'}
        </button>
        <button disabled={busy || saving} onClick={() => void skip()}>
          I don't have the code here
        </button>
      </div>
    </section>
  );
}
