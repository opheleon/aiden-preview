import type { RunManifest } from '../../../../packages/contracts/src/index';

/** What the person can do about work that stopped: look again, or rewrite what done means. */
export type Recovery = 'look' | 'rewrite';

/**
 * Header text while no brief exists yet, plus what stopped and how to recover, when something
 * did. With a brief, only `note` is set and the headline comes from the brief itself.
 */
export interface BriefState {
  headline?: string;
  lands?: string;
  note: { text: string; recovery: Recovery } | null;
}

/** Whether a saved run ended without finishing; a run this window is not following counts too. */
const stoppedEarly = (run: RunManifest | undefined): run is RunManifest =>
  !!run && run.status !== 'completed' && run.status !== 'review';

/**
 * Why a run stopped, in plain words. A run still marked running while Aiden is idle was cut off
 * when the app closed, which is where Teams keeps going.
 */
export function stopReason(run: RunManifest): string {
  if (run.status === 'running' || run.status === 'waiting')
    return 'Paused while Aiden was closed. On Teams, it keeps going.';
  if (run.status === 'cancelled') return 'It was stopped before it finished.';
  return run.error ?? 'It stopped before it finished.';
}

/** The newest rewrite or look that stopped early, if it is the newest of the two. */
function stoppedWork(runs: RunManifest[]): RunManifest | null {
  const prepare = runs.find((r) => r.kind === 'prepare');
  const look = runs.find((r) => r.kind === 'report');
  const latest = [prepare, look]
    .filter((r): r is RunManifest => !!r)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return stoppedEarly(latest) ? latest : null;
}

/**
 * Header state before any look finished, or a note about the latest stopped work over an older
 * brief. Examples: a first look that failed reads "Aiden's first look didn't finish." with the
 * reason and Look again; a failed rewrite reads "Aiden could not write what done means." with
 * Try again.
 */
export function briefState(input: {
  busy: boolean;
  hasBaseline: boolean;
  hasReport: boolean;
  runs: RunManifest[];
}): BriefState {
  const stopped = input.busy ? null : stoppedWork(input.runs);
  const recovery: Recovery = stopped?.kind === 'prepare' ? 'rewrite' : 'look';
  if (!input.hasBaseline) {
    if (input.busy)
      return {
        headline: 'Aiden is writing the requirements.',
        lands: 'The first brief is minutes away.',
        note: null,
      };
    return stopped
      ? {
          headline: 'Aiden could not write the requirements.',
          lands: stopReason(stopped),
          note: { text: '', recovery: 'rewrite' },
        }
      : {
          headline: 'No requirements yet.',
          lands: 'Nothing has started for this project.',
          note: { text: '', recovery: 'rewrite' },
        };
  }
  if (!input.hasReport) {
    if (input.busy)
      return {
        headline: 'Running the first check.',
        lands: 'It assesses the code. Beta verification follows merge.',
        note: null,
      };
    return stopped
      ? {
          headline:
            recovery === 'look'
              ? "The first check didn't finish."
              : 'Aiden could not rewrite the requirements.',
          lands: stopReason(stopped),
          note: { text: '', recovery },
        }
      : {
          headline: 'No check finished yet.',
          lands: 'Aiden looks when your code changes, and every morning.',
          note: null,
        };
  }
  if (!stopped) return { note: null };
  const what =
    recovery === 'look'
      ? "The latest check didn't finish, so this is from the one before."
      : 'Aiden could not rewrite the requirements, so this uses the previous version.';
  return { note: { text: `${what} ${stopReason(stopped)}`, recovery } };
}
