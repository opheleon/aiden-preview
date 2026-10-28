import { type JSX, useState } from 'react';

import type { CodingJob } from '../../../../packages/contracts/src/index';
import { isBlocking } from '../../../../packages/reporting/src/blockers';
import type { CodingDeliveryState } from '../hooks/useCodingDelivery';
import type { Workspace } from '../hooks/useWorkspace';

/**
 * The coding agent a model setting runs, as people see it.
 * Example: a project set to Codex shows "Codex".
 */
function agentName(runtime: Pick<CodingJob['runtime'], 'provider'>): string {
  return runtime.provider === 'claude' ? 'Claude Code' : 'Codex';
}

/** External coding delivery in Claude Code or Codex, with status distinct from requirement completion. */
export function CodingDelivery({
  workspace,
  delivery,
}: {
  workspace: Workspace;
  delivery: CodingDeliveryState;
}): JSX.Element {
  const { project, call, action, busy } = workspace;
  const { jobs, setJobs } = delivery;
  const agent = agentName(project.runtime);
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
        {agent} implements the change and runs local tests in its own worktree. Aiden tracks the PR
        and verifies beta after merge. Nothing is merged or deployed automatically.
      </p>
      {blocked && (
        <p role="status">Resolve blocking scope decisions before dispatching a coding job.</p>
      )}
      {delivery.enabled && (
        <details>
          <summary>Send work to {agent}</summary>
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
            Uses this project's model, effort, and billing selection.{' '}
            {project.runtime.provider === 'claude'
              ? "Claude Code's automatic permission checks remain enabled."
              : "Codex runs in its sandbox, which can change only this job's worktree."}
          </p>
          <button
            disabled={
              busy || starting || blocked || unfinished || !repositoryId || !instruction.trim()
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
            Start {agent}
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
          <summary>Local checks reported by {agentName(job.runtime)}</summary>
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
        <p>Session: {job.sessionId}</p>
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
          Stop {agentName(job.runtime)}
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
