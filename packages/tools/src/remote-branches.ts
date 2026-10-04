import type { Project } from '../../contracts/src/index.js';
import { git, type Repository } from './git.js';
import type { RemoteDefault } from './remote-default.js';

/** A project-specific branch selection, independent of the local checkout after saving. */
export type MonitoredBranch = NonNullable<Repository['monitoredBranch']>;

/** List configured remote names without exposing remote URLs or credentials. */
async function remotes(repo: Repository): Promise<string[]> {
  return (await git(repo.path, ['remote']))
    .trim()
    .split('\n')
    .filter((name) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name));
}

/** Default to the current branch's upstream, or its same-named branch on origin/the sole remote. */
export async function currentRemoteBranch(repo: Repository): Promise<MonitoredBranch | undefined> {
  const branch = (await git(repo.path, ['branch', '--show-current'])).trim();
  if (!branch) return undefined;
  const names = await remotes(repo);
  const upstream = (
    await git(repo.path, [
      'for-each-ref',
      '--format=%(upstream:remotename)|%(upstream:remoteref)',
      `refs/heads/${branch}`,
    ])
  )
    .trim()
    .split('|');
  if (names.includes(upstream[0]!) && upstream[1]?.startsWith('refs/heads/'))
    return { remote: upstream[0]!, branch: upstream[1].slice(11) };
  const remote = names.includes('origin') ? 'origin' : names.length === 1 ? names[0] : undefined;
  return remote ? { remote, branch } : undefined;
}

/** Resolve initial defaults once; unavailable repositories remain explicitly unconfigured. */
export async function withMonitoredBranches(project: Project): Promise<Project> {
  return {
    ...project,
    repositories: await Promise.all(
      project.repositories.map(async (repo) => {
        if (repo.monitoredBranch) return repo;
        try {
          const monitoredBranch = await currentRemoteBranch(repo);
          return monitoredBranch ? { ...repo, monitoredBranch } : repo;
        } catch {
          return repo;
        }
      }),
    ),
  };
}

/** Query live heads on every configured remote; partial failures never become selectable branches. */
export async function remoteBranches(
  repo: Repository,
): Promise<{ branches: MonitoredBranch[]; warnings: string[] }> {
  const names = await remotes(repo);
  const branches: MonitoredBranch[] = [];
  const warnings: string[] = [];
  for (const remote of names) {
    try {
      const listing = await git(repo.path, ['ls-remote', '--heads', remote]);
      for (const line of listing.trim().split('\n')) {
        const match = line.match(/^[a-f0-9]{40,64}\s+refs\/heads\/(\S+)$/);
        if (match) branches.push({ remote, branch: match[1]! });
      }
    } catch {
      warnings.push(`Could not read ${remote}. Check Git access and retry.`);
    }
  }
  if (!names.length) warnings.push('No Git remote is configured for this repository.');
  return {
    branches: branches.sort((a, b) =>
      `${a.remote}/${a.branch}`.localeCompare(`${b.remote}/${b.branch}`),
    ),
    warnings,
  };
}

/** Read the exact selected remote head; deleted, unpushed and inaccessible branches never fall back. */
export async function monitoredHead(
  repo: Repository,
  signal?: AbortSignal,
): Promise<RemoteDefault> {
  const selected = repo.monitoredBranch ?? (await currentRemoteBranch(repo));
  if (!selected) throw new Error('Choose a remote branch in Project settings.');
  if (!(await remotes(repo)).includes(selected.remote))
    throw new Error('The selected remote is unavailable.');
  const ref = `refs/heads/${selected.branch}`;
  await git(repo.path, ['check-ref-format', ref], signal);
  const listing = await git(repo.path, ['ls-remote', '--refs', selected.remote, ref], signal);
  const sha = listing
    .split('\n')
    .map((line) => line.split(/\s+/))
    .find((row) => row[1] === ref)?.[0];
  if (!sha || !/^[a-f0-9]{40,64}$/.test(sha))
    throw new Error('The selected branch is unavailable on the remote.');
  return {
    remote: selected.remote,
    branch: `${selected.remote}/${selected.branch}`,
    sha,
    checkedAt: new Date().toISOString(),
  };
}

/** Fetch the selected commit into a private ref without moving local or tracking branches. */
export async function fetchMonitoredBranch(
  repo: Repository,
  signal?: AbortSignal,
): Promise<RemoteDefault> {
  const head = await monitoredHead(repo, signal);
  await git(
    repo.path,
    [
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      '--no-auto-maintenance',
      '--refmap=',
      head.remote,
      `+${head.sha}:refs/aiden/monitored`,
    ],
    signal,
  );
  await git(repo.path, ['cat-file', '-e', `${head.sha}^{commit}`], signal);
  return head;
}
