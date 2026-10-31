import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import { githubCliEnv } from './github-accounts.js';

const exec = promisify(execFile);

/** A github.com pull request URL; anything else never reaches the GitHub CLI. */
const pullRequestUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/;

/** How the GitHub CLI groups a check's state; anything it adds later reads as still running. */
const CheckSchema = z.object({
  name: z.string(),
  bucket: z.enum(['pass', 'fail', 'pending', 'skipping', 'cancel']).catch('pending'),
  link: z.string().nullish(),
});

/** One CI check on a pull request, as the GitHub CLI reports it. */
export type PullRequestCheck = z.infer<typeof CheckSchema>;

/**
 * Read a pull request's CI checks with `gh pr checks --json`, read only and without prompts.
 * The CLI exits non-zero while checks fail (1) or are pending (8) but still prints the JSON, so
 * that output is used; a pull request with no checks at all reads as an empty list. Any other
 * failure is reported in plain words without echoing the CLI's output.
 * Example: a PR with a passing build and a running test job gives two checks, `pass` and `pending`.
 */
export async function readPullRequestChecks(
  url: string,
  signal?: AbortSignal,
): Promise<PullRequestCheck[]> {
  if (!pullRequestUrl.test(url)) throw new Error('This is not a GitHub pull request URL.');
  const run = await exec('gh', ['pr', 'checks', url, '--json', 'name,state,bucket,link'], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: githubCliEnv(),
    ...(signal ? { signal } : {}),
  }).then(
    ({ stdout }) => ({ ok: true, stdout, stderr: '' }),
    (error: { stdout?: unknown; stderr?: unknown }) => ({
      ok: false,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    }),
  );
  signal?.throwIfAborted();
  const stdout = run.ok || run.stdout.trim().startsWith('[') ? run.stdout : null;
  if (stdout === null) {
    if (/no checks reported/i.test(run.stderr)) return [];
    throw new Error(
      'Could not read the pull request checks. Check gh authentication and repository access.',
    );
  }
  return checksFrom(stdout);
}

/** Validate the CLI's JSON; malformed output is an error, never an empty (passing) list. */
function checksFrom(stdout: string): PullRequestCheck[] {
  let value: unknown = null;
  try {
    value = JSON.parse(stdout || '[]');
  } catch {
    // Reported below as unreadable checks.
  }
  const parsed = z.array(CheckSchema).safeParse(value);
  if (!parsed.success) throw new Error('GitHub answered with checks Aiden could not read.');
  return parsed.data;
}
