import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Snapshot } from '../../contracts/src/index.js';
import { git } from '../../tools/src/git.js';

/** A short, file-based picture of one repository, read before requirements are written. */
export interface RepositoryMap {
  /** The repository ID, which the search and read tools take as `repositoryId`. */
  id: string;
  name: string;
  /** The commit this map read, which the search and read tools take as `sha`; empty without Git. */
  sha: string;
  /** The checked-out branch, for example "main". */
  branch: string;
  /** The day of the latest commit, for example "2026-10-20"; empty when Git cannot say. */
  lastChange: string;
  /** The start of the README; evidence, never instructions. */
  readme: string;
  /** Top two folder levels, for example "src/ (240 files): components/, views/, main.ts". */
  layout: string[];
  /** What each package or module manifest says the code is built with. */
  manifests: { path: string; summary: string }[];
  /** Files whose path or text mentions a word from the goal, such as "zoom" or "calendar". */
  related: string[];
}

/** Longest README excerpt in the map. */
const readmeLimit = 2_000;
/** Folders and files shown at the top level, and children shown under each folder. */
const layoutLimit = { top: 40, children: 12 };
/** Manifests read per repository, and how much of a non-JSON manifest is kept. */
const manifestLimit = { count: 6, text: 400 };
/** Words taken from the goal, and related files listed per repository. */
const relatedLimit = { words: 8, files: 25 };
/** How long one Git listing or search may take before the map goes without it. */
const gitLimitMs = 5_000;
/** Most repositories mapped. */
const repositoryLimit = 6;
/** Repositories with no commit in this long are left out unless nothing newer exists. */
const staleMs = 180 * 24 * 60 * 60 * 1000;
/** Manifest files that say what a package or module is built with. */
const manifestNames = new Set([
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
  'build.gradle',
]);
/** Common words that would match half of any codebase. */
const commonWords = new Set(
  (
    'about able after also and any app apps build built can could each every feature features ' +
    'from have into just like make more need needs new only other page pages should some than ' +
    'that their them then there they this those through use used user users using want when ' +
    'where which while will with work would your'
  ).split(' '),
);

/**
 * The words in a goal worth looking for in file paths and text, longest first.
 * Example: "Auto create Zoom meetings on calendar events" gives meetings, calendar, create, events,
 * auto, zoom.
 */
export function goalWords(intent: string): string[] {
  const words = intent.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !commonWords.has(w)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, relatedLimit.words);
}

/** The top two folder levels of a file list, with file counts per folder. */
export function layoutOf(files: string[]): string[] {
  const top = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const file of files) {
    const [first, second] = file.split('/');
    if (!first) continue;
    if (second === undefined) {
      top.set(first, top.get(first) ?? new Set());
      continue;
    }
    const folder = `${first}/`;
    const children = top.get(folder) ?? new Set<string>();
    children.add(file.split('/').length > 2 ? `${second}/` : second);
    top.set(folder, children);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...top.entries()].slice(0, layoutLimit.top).map(([entry, children]) => {
    if (!entry.endsWith('/')) return entry;
    const shown = [...children].slice(0, layoutLimit.children);
    const more = children.size > shown.length ? `, and ${children.size - shown.length} more` : '';
    return `${entry} (${counts.get(entry)} files): ${shown.join(', ')}${more}`;
  });
}

/** A manifest's name, scripts, and dependencies, or the start of a non-JSON manifest. */
function manifestSummary(file: string, text: string): string {
  if (path.basename(file) !== 'package.json') return text.slice(0, manifestLimit.text);
  try {
    const json = JSON.parse(text) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...json.dependencies, ...json.devDependencies }).slice(0, 40);
    return [
      json.name ? `name ${json.name}` : '',
      json.scripts ? `scripts ${Object.keys(json.scripts).join(', ')}` : '',
      deps.length ? `dependencies ${deps.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  } catch {
    return text.slice(0, manifestLimit.text);
  }
}

/** Read a file in the repository, or nothing when it cannot be read. */
async function readText(root: string, file: string, limit: number): Promise<string> {
  try {
    return (await readFile(path.join(root, file), 'utf8')).slice(0, limit);
  } catch {
    return '';
  }
}

/** Files whose path or text mentions a goal word; text matches come from `git grep`. */
async function relatedFiles(root: string, files: string[], words: string[]): Promise<string[]> {
  if (!words.length) return [];
  const byPath = files.filter((file) => words.some((w) => file.toLowerCase().includes(w)));
  const args = ['grep', '-l', '-i', '-I', '-F', ...words.flatMap((w) => ['-e', w]), '--'];
  const byText: string[] = await git(root, args, AbortSignal.timeout(gitLimitMs)).then(
    (out) => out.split('\n').filter(Boolean),
    () => [],
  );
  return [...new Set([...byPath, ...byText])].slice(0, relatedLimit.files);
}

/** Map one repository from its tracked files; a folder Git cannot list maps to its README only. */
async function mapRepository(
  repo: { id: string; path: string },
  words: string[],
  changed: number,
): Promise<RepositoryMap> {
  const files: string[] = await git(repo.path, ['ls-files'], AbortSignal.timeout(gitLimitMs)).then(
    (out) => out.split('\n').filter(Boolean),
    () => [],
  );
  const head = await git(
    repo.path,
    ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'],
    AbortSignal.timeout(gitLimitMs),
  ).then(
    (out) => out.split('\n').map((line) => line.trim()),
    () => ['', ''],
  );
  const readmeFile = ['README.md', 'readme.md', 'README'].find((f) => files.includes(f));
  const manifests = files
    .filter((f) => manifestNames.has(path.basename(f)) && f.split('/').length <= 3)
    .filter((f) => !f.includes('node_modules/'))
    .slice(0, manifestLimit.count);
  return {
    id: repo.id,
    name: path.basename(repo.path),
    sha: /^[a-f0-9]{40,64}$/.test(head[0] ?? '') ? head[0]! : '',
    branch: head[1] ?? '',
    lastChange: changed ? new Date(changed).toISOString().slice(0, 10) : '',
    readme: readmeFile ? await readText(repo.path, readmeFile, readmeLimit) : '',
    layout: layoutOf(files),
    manifests: await Promise.all(
      manifests.map(async (file) => ({
        path: file,
        summary: manifestSummary(file, await readText(repo.path, file, 64_000)),
      })),
    ),
    related: await relatedFiles(repo.path, files, words),
  };
}

/** When a repository last had a commit, in milliseconds; 0 when Git cannot say. */
async function lastCommit(repo: { path: string }): Promise<number> {
  const out = await git(
    repo.path,
    ['log', '-1', '--format=%ct'],
    AbortSignal.timeout(gitLimitMs),
  ).catch(() => '');
  return Number(out.trim()) * 1000 || 0;
}

/** How strongly a mapped repository relates to the goal: its name, then README, then files. */
function relevance(map: RepositoryMap, words: string[]): number {
  const name = map.name.toLowerCase();
  const readme = map.readme.toLowerCase();
  return (
    words.filter((w) => name.includes(w)).length * 3 +
    words.filter((w) => readme.includes(w)).length +
    (map.related.length ? 2 : 0)
  );
}

/**
 * The plan step's look at what already exists, read from files with no model call, so the
 * requirements use the product's own names and skip questions the code already answers.
 * Repositories with no commit in six months are left out while newer ones exist; of the rest,
 * the ones whose name, README, or files mention the goal come first, up to six. Example: for
 * "Zoom meetings on calendar events", calendar-api and calendar-ui are mapped with their
 * dependencies and any file already mentioning zoom, and a stale sales_scripts is not.
 * @param repositories The project's connected repositories.
 * @param intent The person's goal, whose words pick related repositories and files.
 * @param now The current time, for the six-month rule.
 */
export async function codeMap(
  repositories: { id: string; path: string }[],
  intent: string,
  now = Date.now(),
): Promise<RepositoryMap[]> {
  const words = goalWords(intent);
  const dated = await Promise.all(
    repositories.map(async (repo) => ({ repo, changed: await lastCommit(repo) })),
  );
  const recent = dated.filter((d) => d.changed && now - d.changed < staleMs);
  const candidates = (recent.length ? recent : dated).sort((a, b) => b.changed - a.changed);
  const maps = await Promise.all(
    candidates
      .slice(0, repositoryLimit * 2)
      .map(({ repo, changed }) => mapRepository(repo, words, changed)),
  );
  const scored = maps.map((map) => ({ map, score: relevance(map, words) }));
  const related = scored.filter((s) => s.score > 0);
  return (related.length ? related : scored)
    .sort((a, b) => b.score - a.score)
    .slice(0, repositoryLimit)
    .map((s) => s.map);
}

/**
 * The mapped commits as snapshots, so the requirements step can search and read the code it
 * plans from, read-only, at exactly what the map showed.
 * Example: a map of calendar-api at abc123 on main gives one local snapshot of abc123.
 */
export function planningSnapshots(maps: RepositoryMap[]): Snapshot[] {
  return maps
    .filter((map) => map.sha)
    .map((map) => ({
      repositoryId: map.id,
      sha: map.sha,
      branch: map.branch || 'HEAD',
      role: 'unknown' as const,
      reason: 'The checked-out code, read while planning the requirements.',
      source: 'local' as const,
    }));
}
