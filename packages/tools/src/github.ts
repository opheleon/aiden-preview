import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Repository } from './git.js';
import { git, validateRepository } from './git.js';
import { githubCliEnv } from './github-accounts.js';
const exec = promisify(execFile);

/** One GitHub repository named by a person, in canonical owner/name form. */
export interface GithubRepository {
  owner: string;
  name: string;
}

/** Longest a first clone may take; large repositories need minutes, not the usual Git minute. */
const cloneTimeoutMs = 15 * 60_000;

/**
 * Read a GitHub repository from a link or short name. Accepts https and SSH links, links to a
 * page inside the repository, and owner/name. Returns null for anything that is not GitHub.
 * Example: "https://github.com/opheleon/aiden/pull/7" and "opheleon/aiden" both give opheleon/aiden.
 */
export function parseGithubRepository(input: string): GithubRepository | null {
  const text = input.trim();
  const match =
    text.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i,
    ) ??
    text.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i) ??
    text.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match?.[1] || !match[2] || match[1].startsWith('.') || match[2].startsWith('.')) return null;
  return { owner: match[1], name: match[2] };
}

/** The clone URL; tests point clones at local bare repositories through AIDEN_GITHUB_CLONE_BASE. */
function cloneUrl(repo: GithubRepository): string {
  const base = process.env.AIDEN_GITHUB_CLONE_BASE;
  return base
    ? path.join(base, repo.owner, `${repo.name}.git`)
    : `https://github.com/${repo.owner}/${repo.name}.git`;
}

/** Run one guarded clone with a long timeout, optionally borrowing GitHub CLI sign-in. */
async function clone(
  source: string,
  destination: string,
  useGithubCli: boolean,
  signal?: AbortSignal,
) {
  await exec(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'protocol.ext.allow=never',
      '-c',
      `protocol.file.allow=${process.env.AIDEN_GITHUB_CLONE_BASE ? 'always' : 'never'}`,
      ...(useGithubCli
        ? ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential']
        : []),
      'clone',
      '--quiet',
      '--no-recurse-submodules',
      '--config',
      'core.hooksPath=/dev/null',
      source,
      destination,
    ],
    {
      timeout: cloneTimeoutMs,
      maxBuffer: 1024 * 1024,
      signal,
      env: { ...githubCliEnv(), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    },
  );
}

/** Whether the GitHub CLI is installed, so its sign-in can reach private repositories. */
async function hasGithubCli(): Promise<boolean> {
  try {
    await exec('gh', ['--version'], { timeout: 10_000, env: githubCliEnv() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep Aiden's own read-only clone of a GitHub repository under `root`, cloning it the first time
 * and fetching it afterwards. Pushing is disabled, hooks never run, and the clone is a full one so
 * code checks and sizing can explore every file. Private repositories use the person's existing
 * Git credentials, or their GitHub CLI sign-in when Git alone cannot reach them.
 * Example: with the project's code folder as root, opheleon/aiden lands in <root>/github/opheleon/aiden.
 */
export async function syncGithubRepository(
  root: string,
  repo: GithubRepository,
  signal?: AbortSignal,
): Promise<Repository> {
  const destination = path.join(root, 'github', repo.owner, repo.name);
  const url = `https://github.com/${repo.owner}/${repo.name}`;
  const record = {
    id: `repo-${createHash('sha256').update(url.toLowerCase()).digest('hex').slice(0, 16)}`,
    path: destination,
    notes: '',
    source: { kind: 'github' as const, name: `${repo.owner}/${repo.name}`, url },
  };
  const exists = await access(path.join(destination, '.git')).then(
    () => true,
    () => false,
  );
  if (exists) {
    await git(destination, ['fetch', '--quiet', '--no-recurse-submodules', 'origin'], signal);
    return validateRepository(record);
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.partial`;
  await rm(temporary, { recursive: true, force: true });
  try {
    try {
      await clone(cloneUrl(repo), temporary, false, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!(await hasGithubCli())) throw error;
      await rm(temporary, { recursive: true, force: true });
      await clone(cloneUrl(repo), temporary, true, signal);
    }
    // Aiden only reads: a push from this clone always fails.
    await git(temporary, ['remote', 'set-url', '--push', 'origin', 'no-push://aiden-read-only']);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    signal?.throwIfAborted();
    throw new Error(
      `Could not clone ${repo.owner}/${repo.name}. Check the link, and for a private repository sign in to GitHub with Git or the GitHub CLI (gh auth login), then try again.`,
      { cause: error },
    );
  }
  return validateRepository(record);
}
