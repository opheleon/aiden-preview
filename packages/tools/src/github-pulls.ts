import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod/v3';

/** Owner and name of a repository hosted on github.com. */
export interface GithubRepository {
  owner: string;
  name: string;
}

/** One pull request returned as a lead for assessment; titles are untrusted text, not evidence. */
export interface PullRequestLead {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  created: string;
  updated: string;
  url: string;
}

/** Search outcome: matching leads, or a plain reason the search could not run. */
export type PullRequestSearch =
  | { total: number; pullRequests: PullRequestLead[]; broadenedTo?: string }
  | { unavailable: string };

const searchUrl = 'https://api.github.com/search/issues';
const itemSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.string().url(),
  pull_request: z.object({ merged_at: z.string().nullable().optional() }).optional(),
});
const pageSchema = z.object({ total_count: z.number().int(), items: z.array(itemSchema) });

/**
 * Parse an HTTPS or SSH github.com remote URL; any other host returns null.
 * Example: `git@github.com:vitejs/vite.git` gives `{ owner: 'vitejs', name: 'vite' }`.
 */
export function githubRepository(remote: string): GithubRepository | null {
  const match = remote
    .trim()
    .match(
      /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
    );
  return match?.[1] && match[2] ? { owner: match[1], name: match[2] } : null;
}

/**
 * Search one public repository's pull requests by text through GitHub's API, without credentials,
 * returning at most 20 leads, most recently updated first. Search qualifiers inside the text are
 * dropped so a query cannot widen the search to other repositories. GitHub requires every word to
 * match, so an empty multi-word search retries once with its longest word and says so: for example
 * "transformIndexHtml bundled dev" becomes "transformIndexHtml".
 */
export async function searchPullRequests(
  repo: GithubRepository,
  text: string,
  state: 'open' | 'merged' | 'all',
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PullRequestSearch> {
  const words = text
    .replace(/\b[\w-]+:\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const first = await searchOnce(repo, words, state, signal, fetchImpl);
  const terms = words.split(' ');
  if (!('total' in first) || first.total > 0 || terms.length < 2) return first;
  const longest = terms.reduce((a, b) => (b.length > a.length ? b : a));
  const broader = await searchOnce(repo, longest, state, signal, fetchImpl);
  return 'total' in broader ? { ...broader, broadenedTo: longest } : first;
}

/** One search request; rate limits and private or missing repositories become plain reasons. */
async function searchOnce(
  repo: GithubRepository,
  words: string,
  state: 'open' | 'merged' | 'all',
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<PullRequestSearch> {
  const filter = state === 'open' ? ' is:open' : state === 'merged' ? ' is:merged' : '';
  const q = `repo:${repo.owner}/${repo.name} is:pr${filter} ${words}`.trim();
  const response = await githubGet(
    `${searchUrl}?per_page=20&sort=updated&q=${encodeURIComponent(q)}`,
    signal,
    fetchImpl,
  );
  if (response.status === 403 || response.status === 429)
    return { unavailable: 'GitHub rate-limited pull request search; try again later.' };
  if (!response.ok)
    return {
      unavailable: `GitHub returned ${response.status}; the repository may be private or unavailable.`,
    };
  const page = pageSchema.parse(await response.json());
  return {
    total: page.total_count,
    pullRequests: page.items.map((item) => ({
      number: item.number,
      title: item.title.slice(0, 200),
      state: item.pull_request?.merged_at ? 'merged' : item.state === 'open' ? 'open' : 'closed',
      draft: item.draft ?? false,
      created: item.created_at.slice(0, 10),
      updated: item.updated_at.slice(0, 10),
      url: item.html_url,
    })),
  };
}

/** Live state of one linked pull request or issue; titles are untrusted text, not evidence. */
export interface LinkState {
  kind: 'pull' | 'issue';
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  title: string;
  updated: string;
}

/**
 * Read the live state of one public pull request or issue without credentials, or null when
 * GitHub cannot answer (rate limit, private, or missing). Example: vitejs/vite #20374 reads as an
 * open draft pull request, which marks its roadmap item as in progress rather than abandoned.
 */
export async function linkState(
  repo: GithubRepository,
  number: number,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkState | null> {
  const response = await githubGet(
    `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${number}`,
    signal,
    fetchImpl,
  ).catch(() => null);
  if (!response?.ok) return null;
  const item = itemSchema.safeParse(await response.json());
  if (!item.success) return null;
  const merged = Boolean(item.data.pull_request?.merged_at);
  return {
    kind: item.data.pull_request ? 'pull' : 'issue',
    state: merged ? 'merged' : item.data.state === 'open' ? 'open' : 'closed',
    draft: item.data.draft ?? false,
    title: item.data.title.slice(0, 200),
    updated: item.data.updated_at.slice(0, 10),
  };
}

/**
 * One unauthenticated GitHub API request with Aiden's headers and a 15-second limit. GitHub's
 * search limit resets each minute, so a rate-limited answer waits for the stated reset (at most
 * 65 seconds) and retries once; a longer wait returns the limited answer for the caller to report.
 */
async function githubGet(
  url: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const first = await githubFetch(url, signal, fetchImpl);
  if (first.status !== 403 && first.status !== 429) return first;
  const wait = rateLimitWait(first.headers, Date.now());
  if (wait === null || wait > 65_000) return first;
  await delay(wait, undefined, signal ? { signal } : undefined);
  return githubFetch(url, signal, fetchImpl);
}

/** Send one request with Aiden's headers and a 15-second limit. */
function githubFetch(url: string, signal: AbortSignal | undefined, fetchImpl: typeof fetch) {
  const timeout = AbortSignal.timeout(15_000);
  return fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Aiden',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

/**
 * Milliseconds until GitHub says the limit resets, from retry-after (seconds) or
 * x-ratelimit-reset (epoch seconds), plus one second of margin; null when neither is given.
 */
export function rateLimitWait(headers: Headers, now: number): number | null {
  const retryAfter = Number(headers.get('retry-after'));
  if (headers.has('retry-after') && Number.isFinite(retryAfter))
    return Math.max(0, retryAfter * 1000) + 1000;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.has('x-ratelimit-reset') && Number.isFinite(reset))
    return Math.max(0, reset * 1000 - now) + 1000;
  return null;
}
