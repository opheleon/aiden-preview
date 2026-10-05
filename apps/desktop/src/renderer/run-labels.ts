import type { LookReason, RunManifest, Stage } from '../../../../packages/contracts/src/index';
import type { RunBlockage } from './run-blockers';

/** What a run was, in the words the brief and run history use. */
export const runTitles: Record<RunManifest['kind'], string> = {
  prepare: 'Wrote requirements',
  report: 'Checked the code',
  verify: 'Checked your app',
  estimate: 'Sized the work',
};

/** What a run is doing while it runs. */
export const activeTitles: Record<RunManifest['kind'], string> = {
  prepare: 'Writing requirements',
  report: 'Checking the code',
  verify: 'Checking your app',
  estimate: 'Sizing the work',
};

/**
 * A run's title: present tense while it runs, past tense after it finishes, and an explicit
 * outcome when it stopped or failed. Example: a stopped code check is "Checking the code stopped".
 */
export function runTitle(run: RunManifest, active: boolean): string {
  const ongoing = run.beta ? 'Checking beta' : activeTitles[run.kind];
  if (active) return ongoing;
  if (run.status === 'cancelled') return `${ongoing} stopped`;
  if (run.status === 'failed') return `${ongoing} failed`;
  return run.beta ? 'Checked beta' : runTitles[run.kind];
}

/** Why a run started. */
export const runReasons: Record<LookReason, string> = {
  you: 'you asked',
  commit: 'after new commits',
  ticket: 'after a ticket status changed',
  morning: 'morning look',
  intent: 'you changed the scope',
  answer: 'after your answer',
};

/** The stages a person sees for each kind of run, in order. */
export const runStages: Record<RunManifest['kind'], { stage: Stage; label: string }[]> = {
  prepare: [{ stage: 'understand', label: 'Write requirements' }],
  report: [
    { stage: 'sync', label: 'Sync repositories' },
    { stage: 'discover', label: 'Choose commits' },
    { stage: 'assess', label: 'Check the code' },
    { stage: 'summary', label: 'Summarize' },
  ],
  verify: [{ stage: 'verify', label: 'Check your app' }],
  estimate: [{ stage: 'estimate', label: 'Size the work' }],
};

/** Separate work waiting on a decision from completed investigation and runtime failures. */
export function runStatus(
  run: RunManifest,
  active: boolean,
  blockage?: RunBlockage | null,
): { label: string; tone: string } {
  if (blockage) return { label: blockage.all ? 'Blocked' : 'Partly blocked', tone: 'partial' };
  if (active) return { label: 'Running', tone: 'implemented' };
  if (run.status === 'completed' || run.status === 'review')
    return { label: 'Done', tone: 'verified' };
  if (run.status === 'failed') return { label: 'Failed', tone: 'incomplete' };
  if (run.status === 'cancelled') return { label: 'Stopped', tone: 'neutral' };
  return { label: 'Interrupted', tone: 'partial' };
}

/** Elapsed time as "42s", "3m 05s", or "1h 02m". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
