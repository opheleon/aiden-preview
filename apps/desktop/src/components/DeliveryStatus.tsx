import type { JSX } from 'react';

import type { CodingJob } from '../../../../packages/contracts/src/index';

const summaries: Record<CodingJob['status'], string> = {
  running: 'Claude Code is working. Local tests belong to the coding agent.',
  awaiting_merge: 'Coding finished. PR open, awaiting review or merge. Beta verification pending.',
  awaiting_deployment: 'PR merged. Waiting for beta deployment and its verification schedule.',
  verifying: 'PR merged. Beta verification is running.',
  verified: 'Beta checks passed. Requirement completion uses the recorded evidence below.',
  failing: 'Beta checks found failures. Follow-up work is needed.',
  unverified: 'Beta verification is incomplete. Requirements remain unverified.',
  needs_input: 'The coding agent needs input before delivery can continue.',
  failed: 'The coding job failed. Review its details before retrying.',
  interrupted: 'The coding job stopped. Its worktree is preserved.',
  stale: 'The scope changed since this coding job. Its results apply to the previous scope.',
};

/** Describe delivery progress without turning agent claims into requirement verification. */
export function deliverySummary(job: CodingJob): string {
  return summaries[job.status];
}

/** The same saved outcome and PR link appear in the overview and activity. */
export function DeliveryStatus({ job }: { job: CodingJob }): JSX.Element {
  return (
    <div>
      <p>
        <strong>{deliverySummary(job)}</strong>
      </p>
      <p className="row-sub">{job.message}</p>
      {job.pullRequestUrl && (
        <a href={job.pullRequestUrl} target="_blank" rel="noreferrer">
          Open pull request
        </a>
      )}
      {job.error && <p role="alert">{job.error}</p>}
    </div>
  );
}
