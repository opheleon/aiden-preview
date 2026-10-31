import { setTimeout as delay } from 'node:timers/promises';

import type { AccountTask, CheckInput } from '../../../contracts/src/accounts-api.js';
import { type PullRequestCheck, readPullRequestChecks } from '../../../tools/src/github-checks.js';
import { ciCheckName, pullRequestLines } from './review-packet.js';
import type { TaskControls, TaskOutput } from './runner.js';
import { PermanentTaskError } from './task-errors.js';

/** Injectable GitHub and clock boundaries, so tests run without gh or real waiting. */
export const verifyServices = {
  checks: readPullRequestChecks,
  wait: (ms: number, signal: AbortSignal): Promise<void> => delay(ms, undefined, { signal }),
  now: (): number => Date.now(),
};

/** How often CI is read again, and how much of the runtime limit is kept to report the result. */
export const verifyTiming = { pollMs: 30_000, reserveMs: 2 * 60_000, defaultBudgetMs: 30 * 60_000 };

/** Longest check detail the server stores. */
const detailLimit = 500;

/** Names joined for a detail line, cut to fit the server's limit. */
function names(prefix: string, checks: PullRequestCheck[]): string {
  return `${prefix}: ${checks.map((check) => check.name).join(', ')}`.slice(0, detailLimit);
}

/**
 * One aggregate check for a pull request's CI: failed when any check failed or was cancelled,
 * pending while any still runs, and otherwise passed (skipped and neutral checks count as passed).
 * A pull request with no CI at all passes, and says so.
 * Example: build passed and lint failed on acme/api#12 gives `CI: acme/api#12`, failed, "Failed: lint".
 */
export function ciResult(url: string, checks: PullRequestCheck[]): CheckInput {
  const name = ciCheckName(url) ?? url.slice(0, 200);
  const base = { name, kind: 'automated' as const, url };
  const failed = checks.filter((check) => check.bucket === 'fail' || check.bucket === 'cancel');
  if (failed.length) return { ...base, state: 'failed', detail: names('Failed', failed) };
  const running = checks.filter((check) => check.bucket === 'pending');
  if (running.length) return { ...base, state: 'pending', detail: names('Still running', running) };
  return {
    ...base,
    state: 'passed',
    detail: checks.length
      ? `${checks.length} ${checks.length === 1 ? 'check' : 'checks'} passed`
      : 'No CI checks on this pull request',
  };
}

/** When to stop waiting: the attempt's runtime limit, less time to report what was found. */
function deadline(task: AccountTask, controls: TaskControls): number {
  const started = task.execution ? new Date(task.execution.startedAt).getTime() : NaN;
  const budget = controls.limits?.absoluteMs ?? verifyTiming.defaultBudgetMs;
  const from = Number.isFinite(started) ? started : verifyServices.now();
  return from + budget - verifyTiming.reserveMs;
}

/**
 * Run a verify task: read the CI of every pull request in the instructions (one URL per line) with
 * the GitHub CLI, and read again about every 30 seconds until none is still running or the time
 * left runs low. Completes with exactly one `CI: owner/repo#n` check per pull request, which the
 * server applies to the reviewed task. No model runs and no code is copied. Stopping the task ends
 * the wait at once. Instructions with no pull request are a permanent failure: every machine would
 * read the same nothing.
 * Example: two PRs whose CI passes on the second read finish after one wait with two passed checks.
 */
export async function runVerify(task: AccountTask, controls: TaskControls): Promise<TaskOutput> {
  const urls = pullRequestLines(task.instructions);
  if (!urls.length)
    throw new PermanentTaskError('This verify task names no GitHub pull request to check.');
  const until = deadline(task, controls);
  let checks: CheckInput[];
  for (;;) {
    controls.signal.throwIfAborted();
    controls.activity?.({ type: 'tool-start', id: 'verify-ci' });
    checks = [];
    for (const url of urls)
      checks.push(ciResult(url, await verifyServices.checks(url, controls.signal)));
    controls.activity?.({ type: 'tool-end', id: 'verify-ci' });
    const pending = checks.filter((check) => check.state === 'pending').length;
    const failed = checks.filter((check) => check.state === 'failed').length;
    controls.progress(
      `CI on ${urls.length} ${urls.length === 1 ? 'pull request' : 'pull requests'}: ${checks.length - pending - failed} passed, ${failed} failed, ${pending} running`,
    );
    if (!pending || verifyServices.now() + verifyTiming.pollMs >= until) break;
    await verifyServices.wait(verifyTiming.pollMs, controls.signal);
  }
  controls.signal.throwIfAborted();
  return {
    result: { pullRequestUrls: urls, checks },
    documentChanged: false,
    checks,
  };
}
