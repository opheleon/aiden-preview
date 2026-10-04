import { type JSX, useState } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';

type Branch = NonNullable<Project['repositories'][number]['monitoredBranch']>;

/** A repository's monitored branch, with live remote choices loaded when the person opens the picker. */
function BranchPicker({
  workspace,
  repo,
}: {
  workspace: Workspace;
  repo: Project['repositories'][number];
}): JSX.Element {
  const [choices, setChoices] = useState<Branch[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const selected = repo.monitoredBranch;
  const [value, setValue] = useState(selected ? JSON.stringify(selected) : '');
  /** Refresh from remote advertisements so stale tracking refs are never offered as current branches. */
  async function showBranches(): Promise<void> {
    setOpen(true);
    setLoading(true);
    try {
      const result = await workspace.call('remoteBranches', {
        projectId: workspace.project.id,
        repositoryId: repo.id,
      });
      setChoices(result.branches);
      setWarnings(result.warnings);
    } catch {
      setWarnings(['Could not load remote branches. Check Git access and retry.']);
    } finally {
      setLoading(false);
    }
  }
  /** Save the choice for this project, reload evidence, and start a fresh assessment of that branch. */
  async function save(): Promise<void> {
    const branch = choices.find((choice) => JSON.stringify(choice) === value);
    if (!branch) return;
    await workspace.action(async () => {
      setLoading(true);
      try {
        await workspace.call('updateMonitoredBranch', {
          projectId: workspace.project.id,
          repositoryId: repo.id,
          monitoredBranch: branch,
        });
        await workspace.load(workspace.project.id);
        await workspace.lookNow();
        setOpen(false);
      } finally {
        setLoading(false);
      }
    });
  }
  return (
    <div className="branch-setting">
      <div className="next-row">
        <div>
          {workspace.project.repositories.length > 1 && (
            <strong>{repo.path.split('/').at(-1)}</strong>
          )}
          <p>
            Monitoring{' '}
            {selected ? (
              <strong>
                {selected.remote}/{selected.branch}
              </strong>
            ) : (
              'not configured'
            )}
          </p>
        </div>
        <button
          className="secondary"
          disabled={workspace.busy || loading}
          onClick={() => void showBranches()}
        >
          {loading ? 'Loading…' : open ? 'Refresh branches' : 'Change branch'}
        </button>
      </div>
      {open && (
        <div className="button-row">
          <label>
            Remote branch
            <select
              aria-label={`Remote branch for ${repo.id}`}
              value={value}
              disabled={loading || workspace.busy}
              onChange={(event) => setValue(event.target.value)}
            >
              <option value="">Choose a remote branch</option>
              {selected &&
                !choices.some((choice) => JSON.stringify(choice) === JSON.stringify(selected)) && (
                  <option value={JSON.stringify(selected)} disabled>
                    {selected.remote}/{selected.branch} (unavailable)
                  </option>
                )}
              {choices.map((choice) => (
                <option key={JSON.stringify(choice)} value={JSON.stringify(choice)}>
                  {choice.remote}/{choice.branch}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              loading ||
              workspace.busy ||
              !choices.some((choice) => JSON.stringify(choice) === value) ||
              value === JSON.stringify(selected)
            }
            onClick={() => void save()}
          >
            Save and check branch
          </button>
        </div>
      )}
      {warnings.map((warning) => (
        <p className="inline-note" role="status" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

/** Project-level monitoring controls; projects sharing a repository can choose different branches. */
export function BranchMonitoring({ workspace }: { workspace: Workspace }): JSX.Element {
  return (
    <section className="card settings-panel" aria-label="Branch monitoring">
      <h2>Branch monitoring</h2>
      <p>
        Aiden checks commits pushed to the selected remote branch. The initial choice follows your
        current branch; it stays fixed until you change it here.
      </p>
      {workspace.project.repositories.map((repo) => (
        <BranchPicker
          key={`${workspace.project.id}-${repo.id}-${JSON.stringify(repo.monitoredBranch)}`}
          workspace={workspace}
          repo={repo}
        />
      ))}
      <p className="fine-print">
        Branch checks establish code progress. Deployment and acceptance checks are separate
        evidence.
      </p>
    </section>
  );
}
