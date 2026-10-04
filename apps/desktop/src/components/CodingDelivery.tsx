import { type JSX, useState } from 'react';

import type { CodingJob } from '../../../../packages/contracts/src/index';
import { isBlocking } from '../../../../packages/reporting/src/blockers';
import type { CodingDeliveryState } from '../hooks/useCodingDelivery';
import type { Workspace } from '../hooks/useWorkspace';

/** External Claude Code delivery, with status distinct from requirement completion. */
export function CodingDelivery({
  workspace,
  delivery,
}: {
  workspace: Workspace;
  delivery: CodingDeliveryState;
}): JSX.Element {
  const { project, call, action, busy } = workspace;
  const { jobs, setJobs } = delivery;
  const [repositoryId, setRepositoryId] = useState(
    project.repositories.length === 1 ? project.repositories[0]!.id : '',
  );
  const [instruction, setInstruction] = useState('');
  const [starting, setStarting] = useState(false);
  const unfinished = jobs.some((job) =>
    ['running', 'awaiting_merge', 'awaiting_deployment', 'verifying'].includes(job.status),
  );
  if (!delivery.enabled && !jobs.length)
    return (
      <p className="row-sub">
        Aiden writes delivery tickets under each feature. Coding-agent dispatch is an optional beta
        in Project settings.
      </p>
    );
  const blocked = workspace.calls?.some(isBlocking);
  return (
    <section className="brief-card" aria-label="External coding agent">
      <h3>External coding agent · Beta</h3>
      <p>
        Claude Code implements the change and runs local tests in its own worktree. Aiden tracks the
        PR and verifies beta after merge. Nothing is merged or deployed automatically.
      </p>
      {blocked && (
        <p role="status">Resolve blocking scope decisions before dispatching a coding job.</p>
      )}
      {delivery.enabled && (
        <details>
          <summary>Send work to Claude Code</summary>
          <label>
            Repository
            <select
              aria-label="Coding repository"
              value={repositoryId}
              onChange={(e) => setRepositoryId(e.target.value)}
            >
              <option value="">Choose a repository</option>
              {project.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.path}
                </option>
              ))}
            </select>
          </label>
          <label>
            Task
            <textarea
              aria-label="Coding task"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Describe the change to implement. Reviewed project requirements are included."
            />
          </label>
          <p>
            Uses this project's Claude model, effort, and billing selection. Claude Code's automatic
            permission checks remain enabled.
          </p>
          {project.runtime.provider !== 'claude' && (
            <p>Select Claude Code in Model settings to dispatch work.</p>
          )}
          <button
            disabled={
              busy ||
              starting ||
              blocked ||
              unfinished ||
              !repositoryId ||
              !instruction.trim() ||
              project.runtime.provider !== 'claude'
            }
            onClick={() => {
              setStarting(true);
              void action(async () => {
                const job = await call('startCoding', {
                  projectId: project.id,
                  repositoryId,
                  instruction,
                });
                setJobs((current) => [job, ...current]);
                setInstruction('');
              }).finally(() => setStarting(false));
            }}
          >
            Start Claude Code
          </button>
        </details>
      )}
      <ul>
        {jobs.map((job) => (
          <CodingJobRow key={job.id} job={job} workspace={workspace} setJobs={setJobs} />
        ))}
      </ul>
    </section>
  );
}

/** Show the saved external outcome and the exact beta run linked to it. */
function CodingJobRow({
  job,
  workspace,
  setJobs,
}: {
  job: CodingJob;
  workspace: Workspace;
  setJobs: (jobs: CodingJob[]) => void;
}): JSX.Element {
  const { action, call, project } = workspace;
  return (
    <li>
      <strong>{job.status.replaceAll('_', ' ')}</strong> ·{' '}
      {job.model ?? job.runtime.model ?? 'Default model'} · Effort:{' '}
      {job.runtime.effort ?? 'default'}
      <p>{job.message}</p>
      {job.error && <p role="alert">{job.error}</p>}
      {job.pullRequestUrl && (
        <p>
          <a href={job.pullRequestUrl} target="_blank" rel="noreferrer">
            Pull request
          </a>
        </p>
      )}
      {job.checks.length > 0 && (
        <details>
          <summary>Local checks reported by Claude Code</summary>
          <ul>
            {job.checks.map((check, i) => (
              <li key={i}>{check}</li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Job details</summary>
        <p>Worktree: {job.worktree}</p>
        <p>Branch: {job.branch}</p>
        <p>Claude session: {job.sessionId}</p>
      </details>
      {job.status === 'running' && (
        <button
          onClick={() =>
            void action(async () => {
              await call('cancelCoding', { projectId: project.id, jobId: job.id });
              setJobs(await call('codingJobs', { projectId: project.id }));
            })
          }
        >
          Stop Claude Code
        </button>
      )}
      {job.verificationRunId && (
        <button
          onClick={() => {
            workspace.setOpenRun(job.verificationRunId!);
            workspace.setArea('runs');
          }}
        >
          View beta check
        </button>
      )}
    </li>
  );
}
