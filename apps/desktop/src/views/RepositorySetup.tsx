import { Check, FolderGit2, GitBranch, ShieldCheck } from 'lucide-react';
import React, { useState } from 'react';

import type { WorkerParams, WorkerResult } from '../../../../packages/contracts/src/api';
import type { Project } from '../../../../packages/contracts/src/index';
import { connectedRepositories, GithubRepositories } from '../components/GithubRepositories';

interface RepositorySetupProps {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  setProjects: (projects: Project[]) => void;
  busy: boolean;
  call: <K extends 'connectCode' | 'projects'>(
    method: K,
    params?: WorkerParams<K>,
  ) => Promise<WorkerResult<K>>;
}

/**
 * The project's GitHub repositories and their branch notes. Aiden keeps a read-only copy of each;
 * saving the list clones new ones and starts a check without rewriting the requirements.
 */
export function RepositorySetup(props: RepositorySetupProps): React.JSX.Element {
  const { project, setProject, busy } = props;
  const [repositories, setRepositories] = useState(() => connectedRepositories(project));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  /** Clone or refresh the listed repositories and save them as the project's code. */
  async function save(): Promise<void> {
    setSaving(true);
    setMessage('');
    try {
      const result = await props.call('connectCode', { projectId: project.id, repositories });
      setProject((current) => ({ ...current, repositories: result.repositories }));
      props.setProjects(await props.call('projects'));
      setMessage(result.runId ? 'Repositories saved. Aiden is checking the code.' : 'Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the repositories.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card">
      <div className="card-heading">
        <div className="section-icon">
          <FolderGit2 size={19} />
        </div>
        <div>
          <h2>Code</h2>
          <p>
            The GitHub repositories for this project. Aiden keeps its own read-only copy of each and
            reads the monitored branch. Each project gets its own fresh copies.
          </p>
        </div>
      </div>
      <label>
        Project name
        <input
          placeholder="e.g. Customer portal"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
      </label>
      <GithubRepositories
        value={repositories}
        onChange={setRepositories}
        disabled={busy || saving}
      />
      <div className="button-row">
        <button className="secondary" disabled={busy || saving} onClick={() => void save()}>
          <GitBranch size={15} /> {saving ? 'Copying repositories…' : 'Save repositories'}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {project.repositories.map((r, i) => (
        <div className="repo" key={r.id} data-testid="discovered-repository">
          <div className="repo-heading">
            <FolderGit2 size={17} />
            <div>
              <strong>{r.source?.name ?? r.path.split(/[\\/]/).at(-1)}</strong>
              <small title={r.source?.url ?? r.path}>{r.source?.url ?? r.path}</small>
            </div>
            <Check size={15} aria-label="Included" />
          </div>
          <input
            aria-label={`Branch notes for ${r.id}`}
            placeholder="Optional: main is production, develop is integration…"
            value={r.notes}
            onChange={(e) =>
              setProject({
                ...project,
                repositories: project.repositories.map((x, j) =>
                  j === i ? { ...x, notes: e.target.value } : x,
                ),
              })
            }
          />
        </div>
      ))}
      <div className="inline-note">
        <ShieldCheck size={16} />
        <span>
          Checks read the monitored remote branch. Local changes are preserved and excluded from
          analysis.
        </span>
      </div>
    </section>
  );
}
