import path from 'node:path';

import type { Project } from '../../contracts/src/index.js';
import { publicError } from '../../runtimes/src/index.js';
import {
  type GithubRepository,
  parseGithubRepository,
  syncGithubRepository,
} from '../../tools/src/github.js';
import {
  listGithubRepositories,
  maxConnectedRepositories,
} from '../../tools/src/github-accounts.js';
import type { Engine } from './engine.js';
import { recordGuideEvent } from './guide.js';
import { startLook } from './look.js';

/** The project's own code folder, where Aiden keeps a fresh read-only clone of each repository. */
export function projectCodeFolder(engine: Engine, projectId: string): string {
  return path.join(engine.store.project(projectId), 'code');
}

/**
 * Read GitHub links into distinct repositories, ignoring case; any link that is not GitHub fails.
 * Example: ["acme/web", "https://github.com/ACME/web"] gives one acme/web.
 */
function githubRepositories(links: string[]): GithubRepository[] {
  const wanted = links.map((link) => {
    const parsed = parseGithubRepository(link);
    if (!parsed) throw new Error(`${link.trim()} is not a GitHub repository link.`);
    return parsed;
  });
  return wanted.filter(
    (repo, index) =>
      wanted.findIndex(
        (other) =>
          other.owner.toLowerCase() === repo.owner.toLowerCase() &&
          other.name.toLowerCase() === repo.name.toLowerCase(),
      ) === index,
  );
}

/** Keep the notes and monitored branch a repository had when it was connected before. */
function carryOver(
  synced: Project['repositories'][number],
  saved: Project['repositories'],
): Project['repositories'][number] {
  const previous = saved.find((existing) => existing.id === synced.id);
  return {
    ...synced,
    notes: previous?.notes ?? '',
    ...(previous?.monitoredBranch ? { monitoredBranch: previous.monitoredBranch } : {}),
  };
}

/**
 * Connect a project's code by GitHub links: clone each repository into the project's own folder
 * the first time, so projects never share or disturb each other's copies, fetch it afterwards, and save them as the project's repositories without rewriting its requirements.
 * Notes and monitored branches carry over for repositories that were already connected. With
 * agreed requirements, a code check starts so Aiden reads the code and estimates the work.
 * Example: ["https://github.com/acme/web", "acme/api"] connects both and starts a check.
 */
export async function connectGithubCode(
  engine: Engine,
  projectId: string,
  links: string[],
  options: { keep?: boolean; check?: boolean } = {},
): Promise<{ runId: string | null; repositories: Project['repositories'] }> {
  const unique = githubRepositories(links);
  const saved = (await engine.state(projectId)).project;
  const repositories: Project['repositories'] = [];
  for (const repo of unique) {
    const synced = await syncGithubRepository(projectCodeFolder(engine, projectId), repo);
    repositories.push(carryOver(synced, saved?.repositories ?? []));
  }
  // Adding from the chat keeps what was already connected; Project settings saves the exact list.
  const kept = options.keep
    ? (saved?.repositories ?? []).filter((r) => !repositories.some((next) => next.id === r.id))
    : [];
  await engine.updateCode(projectId, [...kept, ...repositories]);
  const { baseline } = await engine.state(projectId);
  const look =
    options.check !== false && baseline && repositories.length
      ? await startLook(engine, projectId, 'you')
      : null;
  return { runId: look?.runId ?? null, repositories: [...kept, ...repositories] };
}

/** Projects whose repositories are being copied right now, so a second request waits its turn. */
const connecting = new Set<string>();

/**
 * Pick repositories from one GitHub account: the named ones, or with none named, its active
 * repositories that are not forks, most recently pushed first, up to the cap.
 * Example: ("acme", []) with 40 repositories gives the 30 pushed most recently.
 */
async function chooseRepositories(
  owner: string,
  names: string[],
): Promise<{ links: string[]; capped: boolean }> {
  if (names.length) return { links: names.map((name) => `${owner}/${name}`), capped: false };
  const listing = await listGithubRepositories(owner, AbortSignal.timeout(60_000));
  if ('unavailable' in listing) throw new Error(listing.unavailable);
  const active = listing.items.filter((repo) => !repo.fork);
  if (!active.length) throw new Error(`${owner} has no active repositories Aiden can read.`);
  return {
    links: active.slice(0, maxConnectedRepositories).map((repo) => `${owner}/${repo.name}`),
    capped: active.length > maxConnectedRepositories,
  };
}

/**
 * Start copying repositories the Guide chose in the chat, and return at once: copies can take
 * minutes, longer than one chat turn. When they finish, the thread gets an event line and a code
 * check starts, which the app follows like any other run. A failure is written to the thread too.
 * Example: ("acme", ["web", "api"]) returns "Copying acme/web and acme/api…" right away.
 */
export function startGithubConnect(
  engine: Engine,
  projectId: string,
  owner: string,
  names: string[],
): string {
  if (connecting.has(projectId))
    throw new Error('Aiden is still copying repositories for this project.');
  connecting.add(projectId);
  const what = names.length
    ? names.map((name) => `${owner}/${name}`).join(', ')
    : `the active repositories in ${owner}`;
  void (async () => {
    try {
      const { links, capped } = await chooseRepositories(owner, names);
      await connectGithubCode(engine, projectId, links, { keep: true, check: false });
      const { baseline } = await engine.state(projectId);
      const event = `Connected ${links.join(', ')} from GitHub.${capped ? ` That is the ${maxConnectedRepositories} most recently pushed; name others to add them.` : ''}${baseline ? ' Aiden is reading the code.' : ''}`;
      // Record the event before the check starts, so the chat shows it when it follows the run.
      await recordGuideEvent(engine, projectId, event).catch(() => {});
      if (baseline) await startLook(engine, projectId, 'you');
    } catch (error) {
      await recordGuideEvent(
        engine,
        projectId,
        `Could not connect ${what}: ${publicError(error)}`,
      ).catch(() => {});
    } finally {
      connecting.delete(projectId);
    }
  })();
  return `Copying ${what} from GitHub. A large repository can take a few minutes.`;
}
