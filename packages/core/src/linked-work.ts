import type { Discovery, Project } from '../../contracts/src/index.js';
import { git } from '../../tools/src/git.js';
import { githubRepository, type LinkState, linkState } from '../../tools/src/github-pulls.js';

/** A pull request or issue the intent links, resolved against the selected branch it belongs to. */
export interface LinkedWork {
  url: string;
  repositoryId: string | null;
  merged: { sha: string; date: string; subject: string } | null;
  /** Live GitHub state, or null when GitHub could not answer; titles are untrusted text. */
  live: LinkState | null;
  note: string;
}

type MergedCommit = LinkedWork['merged'] | 'unsearchable';
const linkPattern = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d+)/g;

/**
 * Remote URL of each repository, read from the person's checkouts before analysis switches to
 * frozen snapshot copies, which have no remotes. Repositories without a readable remote are left out.
 */
export async function repositoryRemotes(
  repositories: Project['repositories'],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const remotes = new Map<string, string>();
  for (const repo of repositories) {
    const url = await git(
      repo.path,
      ['remote', 'get-url', repo.monitoredBranch?.remote ?? 'origin'],
      signal,
    ).catch(() => null);
    if (url?.trim()) remotes.set(repo.id, url.trim());
  }
  return remotes;
}

/**
 * Resolve each GitHub pull request or issue linked in the intent: the merged commit on the
 * selected branch of the repository the link names, and the link's live state on GitHub. Example:
 * `.../typescript-go/pull/4712` resolves to the commit "Content mappers (#4712)" even when the
 * intent says the code later moved, and `.../vite/pull/20374` reads as an open draft, in progress.
 */
export async function linkedWork(
  intent: string,
  remotes: Map<string, string>,
  frozenPath: (repositoryId: string) => string,
  snapshots: Discovery['snapshots'],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkedWork[]> {
  const owners = [...remotes].flatMap(([id, url]) => {
    const github = githubRepository(url);
    return github ? [{ id, slug: `${github.owner}/${github.name}`.toLowerCase() }] : [];
  });
  const seen = new Set<string>();
  const results: LinkedWork[] = [];
  for (const [url, owner, name, number] of intent.matchAll(linkPattern)) {
    if (!owner || !name || !number || seen.has(url) || seen.size >= 40) continue;
    seen.add(url);
    const id = owners.find((o) => o.slug === `${owner}/${name}`.toLowerCase())?.id;
    const target = id ? selectedTarget(id, snapshots) : null;
    const merged = target
      ? await mergedCommit(frozenPath(target.repositoryId), target.sha, number, signal)
      : null;
    const live = await linkState({ owner, name }, Number(number), signal, fetchImpl);
    results.push({
      url,
      repositoryId: target?.repositoryId ?? null,
      merged: merged === 'unsearchable' ? null : merged,
      live,
      note: describe(merged, live, target !== null),
    });
  }
  return results;
}

/** The selected remote snapshot of a repository, falling back to any snapshot it has. */
function selectedTarget(
  repositoryId: string,
  snapshots: Discovery['snapshots'],
): { repositoryId: string; sha: string } | null {
  const own = snapshots.filter((s) => s.repositoryId === repositoryId);
  const snapshot = own.find((s) => s.source !== undefined && s.source !== 'local') ?? own[0];
  return snapshot ? { repositoryId, sha: snapshot.sha } : null;
}

/** The newest selected-branch commit whose subject names `#number`, or why none can be given. */
async function mergedCommit(
  repoPath: string,
  sha: string,
  number: string,
  signal?: AbortSignal,
): Promise<MergedCommit> {
  const lines = await git(
    repoPath,
    ['log', '-20', '--format=%H %cs %s', '--fixed-strings', `--grep=#${number}`, sha, '--'],
    signal,
  ).catch(() => null);
  if (lines === null) return 'unsearchable';
  const hit = lines
    .split('\n')
    .map((line) => line.match(/^(\S+) (\S+) (.*)$/))
    .find((m) => m?.[3] && new RegExp(`#${number}(?!\\d)`).test(m[3]));
  return hit?.[1] && hit[2] && hit[3] ? { sha: hit[1], date: hit[2], subject: hit[3] } : null;
}

/** One plain sentence telling the assessment what the link means for its roadmap item. */
function describe(merged: MergedCommit, live: LinkState | null, selected: boolean): string {
  if (merged && merged !== 'unsearchable') return 'Merged on the selected branch.';
  const where = selected
    ? 'not merged on the selected branch'
    : 'in a repository Aiden does not read';
  if (live) return describeLive(live, where, selected);
  if (merged === 'unsearchable')
    return 'The selected branch history could not be searched and GitHub did not answer; unknown.';
  return selected
    ? 'Not merged on the selected branch; GitHub did not answer, so its state is unknown.'
    : 'In a repository Aiden does not read; GitHub did not answer, so its state is unknown.';
}

/** Describe a link GitHub answered for: an open pull request is work in progress. */
function describeLive(live: LinkState, where: string, selected: boolean): string {
  if (live.kind === 'issue') return `${live.state === 'open' ? 'Open' : 'Closed'} issue, ${where}.`;
  if (live.state === 'open')
    return `Open${live.draft ? ' draft' : ''} pull request, ${where}: work in progress.`;
  if (live.state === 'merged')
    return `Merged on GitHub but ${selected ? 'not found on the selected branch' : where}.`;
  return `Closed without merging; ${where}.`;
}
