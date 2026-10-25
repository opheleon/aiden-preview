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
  headRefOid: z.string().optional(),
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
      'url,state,headRefName,headRefOid,baseRefName,headRepository,headRepositoryOwner,mergeCommit,reviewDecision,statusCheckRollup',
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
  if (matches.length > 1)
    throw new Error(
      'Multiple pull requests match this delivery branch. Review them before continuing.',
    );
  if (!matches.length) return null;
  const url = matches[0]!.url;
  await readPullRequest(repository, url, branch, baseBranch);
  return url;
}
/**
 * Publish a finished team coding job: push only its `aiden/job-*` branch with the GitHub CLI's
 * credentials, then open the pull request. The clone itself stays read-only (its push URL is a
 * guard), so the coding agent can never push; Aiden publishes exactly one branch, never the base.
 * Returns the new pull request's URL.
 */
/** A publication is restricted to a committed Aiden branch and current attempt authority. */
export interface PublicationInput {
  worktree: string;
  repository: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  signal?: AbortSignal;
  authorize?: () => Promise<void>;
  commit?: string;
  remoteOnly?: boolean;
}

/** Publish or reconcile one committed branch without duplicating an existing PR. */
export async function publishJobBranch(input: PublicationInput): Promise<string> {
  const { repository, branch, baseBranch } = input;
  if (!name.test(repository) || !/^aiden\/job-[a-f0-9-]+$/.test(branch))
    throw new Error('Aiden publishes only its own job branches.');
  input.signal?.throwIfAborted();
  await input.authorize?.();
  const existing = await findJobPullRequest(repository, branch, baseBranch);
  if (existing) {
    await verifyPublicationCommit(repository, existing, branch, baseBranch, input.commit);
    return existing;
  }
  await ensurePublishedBranch(input);
  await input.authorize?.();
  input.signal?.throwIfAborted();
  try {
    const { stdout } = await exec(
      'gh',
      ['pr', 'create', '--repo', repository, '--base', baseBranch, '--head', branch].concat([
        '--title',
        input.title.slice(0, 200),
        '--body',
        input.body.slice(0, 60000),
      ]),
      { timeout: 60000, signal: input.signal, env: { ...process.env, GH_PROMPT_DISABLED: '1' } },
    );
    const url = stdout.trim().split('\n').pop() ?? '';
    if (!/^https:\/\/github\.com\/\S+\/pull\/\d+$/.test(url)) throw new Error(url);
    await verifyPublicationCommit(repository, url, branch, baseBranch, input.commit);
    return url;
  } catch {
    input.signal?.throwIfAborted();
    const recovered = await findJobPullRequest(repository, branch, baseBranch);
    if (recovered) {
      await verifyPublicationCommit(repository, recovered, branch, baseBranch, input.commit);
      return recovered;
    }
    throw new Error('Aiden pushed the branch but could not open the pull request with gh.');
  }
}

/** A branch match alone is insufficient: publication must contain the checkpointed commit. */
export async function verifyPublicationCommit(
  repository: string,
  url: string,
  branch: string,
  baseBranch: string,
  commit?: string,
): Promise<void> {
  const pr = await readPullRequest(repository, url, branch, baseBranch);
  if (commit && pr.headRefOid !== commit)
    throw new Error('The pull request does not contain the checkpointed commit.');
}

/** A checkpoint exists but its commit is neither on this machine nor on the remote branch. */
export class MissingPublicationCommit extends Error {
  /** Explain the recovery boundary without pretending unpublished local files are portable. */
  constructor() {
    super(
      'The committed work is only available on the previous machine. Bring it online to recover the checkpoint.',
    );
    this.name = 'MissingPublicationCommit';
  }
}

/** Push the checkpointed local commit, or confirm a previously pushed remote commit. */
async function ensurePublishedBranch(input: PublicationInput): Promise<void> {
  const { worktree, repository, branch } = input;
  if (input.remoteOnly) {
    const remote = await deliveryGitServices.git(
      worktree,
      [
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        'ls-remote',
        `https://github.com/${repository}.git`,
        `refs/heads/${branch}`,
      ],
      input.signal,
    );
    if (!remote.trim()) throw new MissingPublicationCommit();
    if (remote.trim().split(/\s+/)[0] !== input.commit)
      throw new Error('The remote branch differs from the committed checkpoint.');
  } else {
    if (
      input.commit &&
      (await deliveryGitServices.git(worktree, ['rev-parse', 'HEAD'])).trim() !== input.commit
    )
      throw new Error('The worktree changed after its publication checkpoint.');
    await input.authorize?.();
    await deliveryGitServices.git(
      worktree,
      [
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        'push',
        `https://github.com/${repository}.git`,
        `HEAD:refs/heads/${branch}`,
      ],
      input.signal,
    );
  }
}
