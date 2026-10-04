import { git, type Repository } from './git.js';

/** The default branch and exact commit advertised by an authenticated remote read. */
export interface RemoteDefault {
  remote: string;
  branch: string;
  sha: string;
  checkedAt: string;
}

/** Use origin, or the only configured remote; never infer delivery from a feature's upstream. */
export async function remoteDefault(
  repo: Repository,
  signal?: AbortSignal,
): Promise<RemoteDefault> {
  const remotes = (await git(repo.path, ['remote'], signal)).trim().split('\n').filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : '';
  if (!remote || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(remote))
    throw new Error('Configure origin or a single remote so Aiden can verify the delivery branch.');
  const advertised = await git(repo.path, ['ls-remote', '--symref', remote, 'HEAD'], signal);
  const ref = advertised.match(/^ref: (refs\/heads\/[^\s]+)\s+HEAD$/m)?.[1];
  const sha = advertised.match(/^([a-f0-9]{40,64})\s+HEAD$/m)?.[1];
  if (!ref || !sha)
    throw new Error(
      'The remote default branch could not be verified. No local branch was substituted.',
    );
  await git(repo.path, ['check-ref-format', ref], signal);
  return {
    remote,
    branch: `${remote}/${ref.slice('refs/heads/'.length)}`,
    sha,
    checkedAt: new Date().toISOString(),
  };
}

/** Fetch only the advertised commit into a private ref; never update a checkout or tracking branch. */
export async function fetchRemoteDefault(
  repo: Repository,
  signal?: AbortSignal,
): Promise<RemoteDefault> {
  const head = await remoteDefault(repo, signal);
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
      `+${head.sha}:refs/aiden/remote-default`,
    ],
    signal,
  );
  await git(repo.path, ['cat-file', '-e', `${head.sha}^{commit}`], signal);
  return head;
}
