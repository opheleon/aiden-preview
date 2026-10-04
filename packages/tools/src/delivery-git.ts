import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import { git, type Repository, validateRepository } from './git.js';
const exec = promisify(execFile);
const name = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
/** Read-only GitHub commands use argument arrays and never reveal provider error output. */
export async function github(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await exec('gh', args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    return JSON.parse(stdout);
  } catch {
    throw new Error('Could not read GitHub. Check gh authentication and repository access.');
  }
}
/** Injectable GitHub read boundary for permission-free regression tests. */
export const deliveryGitServices = { github, git };
/** Resolve the trusted origin to a GitHub repository before accepting any agent-supplied PR. */
export async function githubRepository(repo: Repository): Promise<string> {
  const remote = (await deliveryGitServices.git(repo.path, ['remote', 'get-url', 'origin'])).trim();
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([^\s]+?)(?:\.git)?$/.exec(remote);
  if (!match?.[1] || !name.test(match[1]))
    throw new Error('Coding jobs require a github.com origin.');
  return match[1];
}
/** Create an isolated branch from the remote default without changing the user's checkout. */
export async function codingWorktree(
  repo: Repository,
  folder: string,
  branch: string,
): Promise<{ repository: string; baseBranch: string }> {
  await validateRepository(repo);
  const repository = await githubRepository(repo);
  const metadata = z
    .object({ defaultBranchRef: z.object({ name: z.string().min(1) }) })
    .parse(
      await deliveryGitServices.github(['repo', 'view', repository, '--json', 'defaultBranchRef']),
    );
  let filters = '';
  try {
    filters = await deliveryGitServices.git(repo.path, ['config', '--get-regexp', '^filter\\.']);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) throw error;
  }
  if (filters.trim())
    throw new Error('Executable checkout filters require a manually prepared checkout.');
  const baseBranch = metadata.defaultBranchRef.name;
  await deliveryGitServices.git(repo.path, ['check-ref-format', `refs/heads/${baseBranch}`]);
  await deliveryGitServices.git(repo.path, [
    'fetch',
    '--no-tags',
    '--no-recurse-submodules',
    'origin',
    `refs/heads/${baseBranch}`,
  ]);
  const sha = (
    await deliveryGitServices.git(repo.path, ['rev-parse', 'FETCH_HEAD^{commit}'])
  ).trim();
  await mkdir(path.dirname(folder), { recursive: true, mode: 0o700 });
  await deliveryGitServices.git(repo.path, ['worktree', 'add', '-b', branch, folder, sha]);
  return { repository, baseBranch };
}
/** Trusted GitHub state for a PR; the agent's summary never supplies merge evidence. */
export const PullRequestSchema = z.object({
  url: z.string().url(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRepository: z.object({ name: z.string() }).nullable(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable(),
  mergeCommit: z.object({ oid: z.string().regex(/^[a-f0-9]{40,64}$/) }).nullable(),
  reviewDecision: z.string().nullable(),
  statusCheckRollup: z.array(z.unknown()).nullable(),
});
/** Validate repository, source branch and target branch before trusting PR state. */
export async function readPullRequest(
  repository: string,
  url: string,
  branch: string,
  baseBranch: string,
): Promise<z.infer<typeof PullRequestSchema>> {
  const parsed = new URL(url);
  const prefix = `/${repository}/pull/`;
  if (
    parsed.origin !== 'https://github.com' ||
    !parsed.pathname.startsWith(prefix) ||
    !/^\d+$/.test(parsed.pathname.slice(prefix.length)) ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('The reported PR does not belong to this job repository.');
  const pr = PullRequestSchema.parse(
    await deliveryGitServices.github([
      'pr',
      'view',
      url,
      '--repo',
      repository,
      '--json',
      'url,state,headRefName,baseRefName,headRepository,headRepositoryOwner,mergeCommit,reviewDecision,statusCheckRollup',
    ]),
  );
  if (
    pr.url !== url ||
    pr.headRefName !== branch ||
    pr.baseRefName !== baseBranch ||
    `${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}` !== repository
  )
    throw new Error('The PR does not match this job branch and target.');
  return pr;
}
/** Recover a finished agent's PR after a tracking failure, using its unique job branch. */
export async function findJobPullRequest(
  repository: string,
  branch: string,
  baseBranch: string,
): Promise<string | null> {
  const matches = z
    .array(z.object({ url: z.string().url() }))
    .parse(
      await deliveryGitServices.github([
        'pr',
        'list',
        '--repo',
        repository,
        '--head',
        branch,
        '--base',
        baseBranch,
        '--state',
        'all',
        '--json',
        'url',
        '--limit',
        '2',
      ]),
    );
  if (matches.length !== 1) return null;
  const url = matches[0]!.url;
  await readPullRequest(repository, url, branch, baseBranch);
  return url;
}
