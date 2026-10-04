import { execFile } from 'node:child_process';
import { mkdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Project, Snapshot } from '../../contracts/src/index.js';
const exec = promisify(execFile);
/** Saved repository identity and canonical root used by guarded Git operations. */
export type Repository = Project['repositories'][number];
const guards = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.external=',
  '-c',
  'submodule.recurse=false',
  '-c',
  'fetch.recurseSubmodules=false',
  '-c',
  'merge.autoStash=false',
  '-c',
  'rebase.autoStash=false',
  '-c',
  'protocol.ext.allow=never',
];
/** Execute Git without hooks, external diff commands, or interactive prompts; errors expose only a coarse message and exit code. */
export async function git(repo: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await exec('git', [...guards, ...args], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60000,
      signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' },
    });
    return stdout;
  } catch (error) {
    if (signal?.aborted) throw error;
    const safe = new Error(
      'Git operation failed. Check repository availability, authentication, and configuration.',
    );
    Object.assign(safe, { code: (error as NodeJS.ErrnoException).code });
    throw safe;
  }
}
/** Require a committed repository root and return its canonical path without changing the checkout. */
export async function validateRepository(repo: Repository): Promise<Repository> {
  const location = await realpath(repo.path);
  const top = (await git(location, ['rev-parse', '--show-toplevel'])).trim();
  if ((await realpath(top)) !== location) throw new Error('Choose the repository root folder.');
  await git(location, ['rev-parse', '--verify', 'HEAD^{commit}']);
  return { ...repo, path: location };
}
/** Fast-forward a clean unchanged checkout only; uncertainty preserves local state and returns a warning. */
export async function syncRepository(repo: Repository, signal?: AbortSignal): Promise<string[]> {
  /** Explain why freshness is unknown while retaining the existing committed snapshots. */
  const warn = (reason: string) => [
    `${repo.id}: ${reason} Existing committed snapshots will be assessed; remote freshness is unverified.`,
  ];
  try {
    // Do not let checkout invoke configured clean/smudge/process filters.
    let filters = '';
    try {
      filters = await git(repo.path, ['config', '--get-regexp', '^filter\\.'], signal);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 1) throw error;
    }
    if (filters.trim())
      return warn('Executable checkout filters are configured; synchronization was skipped.');
    if (
      (
        await git(repo.path, ['status', '--porcelain=v1', '--untracked-files=normal'], signal)
      ).trim()
    )
      return warn(
        'Local changes were preserved; synchronization was skipped. Uncommitted changes are excluded.',
      );
    if (!(await git(repo.path, ['branch', '--show-current'], signal)).trim())
      return warn('Detached HEAD; synchronization was skipped.');
    try {
      await git(repo.path, ['rev-parse', '--verify', '@{upstream}'], signal);
    } catch {
      return warn('No available upstream; synchronization was skipped.');
    }
    const oldHead = (await git(repo.path, ['rev-parse', 'HEAD'], signal)).trim();
    await git(repo.path, ['fetch', '--no-recurse-submodules'], signal);
    if (
      (
        await git(repo.path, ['status', '--porcelain=v1', '--untracked-files=normal'], signal)
      ).trim() ||
      (await git(repo.path, ['rev-parse', 'HEAD'], signal)).trim() !== oldHead
    )
      return warn('The checkout changed during synchronization; update skipped.');
    await git(repo.path, ['merge-base', '--is-ancestor', 'HEAD', '@{upstream}'], signal);
    // fetch + ff-only merge is a pull split at the point where guards can be rechecked.
    await git(repo.path, ['merge', '--ff-only', '--no-autostash', '@{upstream}'], signal);
    return [];
  } catch (e) {
    if (signal?.aborted) throw e;
    return warn(
      'Could not fast-forward or fetch the configured upstream. No automatic conflict resolution was attempted.',
    );
  }
}
/** Commits checked out in the repository's other worktrees, where in-progress work often lives. */
async function worktreeHeads(
  repo: Repository,
  head: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const listing = await git(repo.path, ['worktree', 'list', '--porcelain'], signal);
    const heads = [...listing.matchAll(/^HEAD ([0-9a-f]{40,64})$/gm)].map((m) => m[1]!);
    return [...new Set(heads)].filter((sha) => sha !== head).slice(0, 4);
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}
/** List bounded recent refs and HEAD without fetching; missing remote defaults remain explicitly unknown. */
export async function inventory(
  repo: Repository,
  signal?: AbortSignal,
): Promise<RepositoryInventory> {
  const head = (await git(repo.path, ['rev-parse', 'HEAD'], signal)).trim();
  let defaultBranch = '';
  try {
    defaultBranch = (
      await git(repo.path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], signal)
    ).trim();
  } catch {
    // Local-only repositories may have no origin/HEAD; refs below still describe their commits.
  }
  const refs = (
    await git(
      repo.path,
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)|%(objectname)',
        'refs/heads',
        'refs/remotes',
      ],
      signal,
    )
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 150)
    .map((s) => {
      const [branch, sha] = s.split('|');
      if (!branch || !sha) throw new Error('Git returned a malformed branch record.');
      return { repositoryId: repo.id, branch, sha };
    });
  return {
    repositoryId: repo.id,
    notes: repo.notes,
    head,
    defaultBranch,
    refs,
    worktrees: await worktreeHeads(repo, head, signal),
    warnings: [
      'PR metadata and deployment-run evidence are unavailable in the local Git prototype.',
      ...(refs.length >= 150 ? ['Branch inventory is limited to 150 recent refs.'] : []),
    ],
  };
}
/** List regular tracked files at a commit, excluding symlinks and submodule entries. */
export async function files(
  repo: Repository,
  sha: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return (await git(repo.path, ['ls-tree', '-r', '-z', '--full-tree', sha], signal))
    .split('\0')
    .filter(Boolean)
    .flatMap((row) => {
      const [meta, name] = row.split('\t');
      return meta?.startsWith('100') && name ? [name] : [];
    });
}
/** Read a regular text blob from the supplied commit; reject paths absent from its tree and binary content. */
export async function readSnapshot(
  repo: Repository,
  snapshot: Snapshot,
  file: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!(await files(repo, snapshot.sha, signal)).includes(file))
    throw new Error('Path is not a regular file in this snapshot.');
  const content = await git(repo.path, ['show', `${snapshot.sha}:${file}`], signal);
  if (content.includes('\0')) throw new Error('Binary file cannot be read as evidence.');
  return content;
}

// Independent objects preserve evidence even if the original checkout or its refs disappear.
/** Copy required commit objects into an independent bare repository and publish it only after a successful fetch. */
export async function freezeRepository(
  repo: Repository,
  shas: string[],
  destination: string,
  signal?: AbortSignal,
): Promise<Repository> {
  try {
    for (const sha of shas) await git(destination, ['cat-file', '-e', `${sha}^{commit}`], signal);
    return { ...repo, path: destination };
  } catch {
    signal?.throwIfAborted();
  }
  await rm(destination, { recursive: true, force: true });
  const temporary = destination + '.partial';
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { mode: 0o700 });
  try {
    await git(temporary, ['init', '--bare', '--quiet'], signal);
    await git(
      temporary,
      [
        '-c',
        'protocol.file.allow=always',
        'fetch',
        '--no-tags',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        repo.path,
        ...[...new Set(shas)].map((sha) => `${sha}:refs/aiden/${sha}`),
      ],
      signal,
    );
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { ...repo, path: destination };
}

/** Local-only branch inventory; warnings explain truncation and evidence unavailable from Git alone. */
export interface RepositoryInventory {
  repositoryId: string;
  notes: string;
  head: string;
  defaultBranch: string;
  refs: { repositoryId: string; branch: string; sha: string }[];
  /** Commits checked out in other worktrees of this repository; older inventories omit it. */
  worktrees?: string[];
  /** Fresh monitored-branch observation; legacy field name retained for saved inventories. */
  remoteDefault?: { remote: string; branch: string; sha: string; checkedAt: string };
  warnings: string[];
}
