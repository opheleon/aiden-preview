import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Project, RepositoryDiscovery } from '../../contracts/src/index.js';
import { git, validateRepository } from './git.js';

const excluded = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'target',
  '__pycache__',
  'venv',
  'env',
  'Pods',
  'DerivedData',
]);
/** Check path containment using path segments rather than a vulnerable textual prefix comparison. */
export function isInsideRoot(root: string, location: string): boolean {
  const relative = path.relative(root, location);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Resolve an absolute selected folder; unavailable or non-directory roots produce recoverable guidance. */
async function projectRoot(input: string): Promise<string> {
  if (!path.isAbsolute(input)) throw new Error('Choose an absolute project folder path.');
  try {
    const root = await realpath(input);
    if (!(await stat(root)).isDirectory()) throw new Error();
    return root;
  } catch {
    throw new Error('The project folder is unavailable. Choose an existing folder.');
  }
}

// Keep the selected folder as the boundary even for saved projects and direct worker requests.
/** Revalidate saved repository roots and uniqueness against the user-selected folder before worker execution. */
export async function validateProjectRepositories(project: Project): Promise<Project> {
  const rootPath = project.rootPath ? await projectRoot(project.rootPath) : undefined;
  const repositories = [];
  for (const repo of project.repositories) {
    const location = await realpath(repo.path);
    if (rootPath && !isInsideRoot(rootPath, location))
      throw new Error('All repositories must be inside the selected project folder.');
    repositories.push(await validateRepository({ ...repo, path: location }));
  }
  if (
    new Set(repositories.map((r) => r.id)).size !== repositories.length ||
    new Set(repositories.map((r) => r.path)).size !== repositories.length
  )
    throw new Error('Repository IDs and folders must be unique.');
  return { ...project, ...(rootPath ? { rootPath } : {}), repositories };
}

/** Scan within explicit folder, depth, and count bounds; skip symlinks and report incomplete discovery. */
export async function discoverRepositories(
  input: string,
  limits: DiscoveryLimits = { maxDepth: 8, maxDirectories: 10000, maxRepositories: 100 },
): Promise<RepositoryDiscovery> {
  const rootPath = await projectRoot(input);
  const repositories: Project['repositories'] = [];
  const warnings = new Set<string>();
  const pending = [{ location: rootPath, depth: 0 }];
  // Folders a discovered repository ignores, such as build output or old checkouts, are not
  // searched for more repositories.
  const ignored = new Set<string>();
  let visited = 0;
  let skipped = 0;
  let skippedIgnored = 0;
  while (pending.length) {
    if (visited++ >= limits.maxDirectories) {
      warnings.add(
        `Discovery stopped at ${limits.maxDirectories} folders. Some repositories may be missing.`,
      );
      break;
    }
    const { location, depth } = pending.shift()!;
    const label = path.relative(rootPath, location) || '.';
    if (ignored.has(location)) {
      skippedIgnored++;
      continue;
    }
    try {
      // Never follow discovered symlinks, including a directory replaced during the scan.
      if ((await realpath(location)) !== location || !(await lstat(location)).isDirectory()) {
        warnings.add(`${label}: linked or changed folder was skipped.`);
        continue;
      }
      const entries = (await readdir(location, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const marker = entries.find((entry) => entry.name === '.git');
      if (marker && (marker.isDirectory() || marker.isFile())) {
        await addRepository(location, label, repositories, ignored, warnings);
        if (repositories.length >= limits.maxRepositories) {
          warnings.add(
            `Discovery stopped at ${limits.maxRepositories} repositories. Coverage may be incomplete.`,
          );
          break;
        }
      } else if (marker) {
        warnings.add(`${label}: unsupported Git metadata was skipped.`);
      }
      skipped += enqueueChildren(entries, location, depth, limits, visited, pending, warnings);
    } catch {
      warnings.add(`${label}: folder could not be read; repositories inside it were not checked.`);
    }
  }
  if (skippedIgnored)
    warnings.add(
      'Folders a repository ignores, such as build output and old checkouts, were not searched.',
    );
  const kept = await foldWorktrees(repositories, rootPath, warnings);
  summarizeScan(skipped, kept.length, warnings);
  return { rootPath, repositories: kept, warnings: [...warnings] };
}

/** Record a repository found during the scan and the folders it ignores; unreadable ones are reported. */
async function addRepository(
  location: string,
  label: string,
  repositories: Project['repositories'],
  ignored: Set<string>,
  warnings: Set<string>,
): Promise<void> {
  try {
    repositories.push(
      await validateRepository({
        id: `repo-${createHash('sha256').update(location).digest('hex').slice(0, 16)}`,
        path: location,
        notes: '',
      }),
    );
    for (const folder of await ignoredFolders(location)) ignored.add(folder);
  } catch {
    warnings.add(
      `${label}: Git repository could not be read or has no commits; excluded from analysis.`,
    );
  }
}

/** Folders a repository's own ignore rules exclude, as absolute paths; none when Git cannot say. */
async function ignoredFolders(repoPath: string): Promise<string[]> {
  try {
    const out = await git(repoPath, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
    ]);
    return out
      .split('\0')
      .filter((entry) => entry.endsWith('/'))
      .map((entry) => path.join(repoPath, entry.slice(0, -1)));
  } catch {
    return [];
  }
}

/**
 * Keep one checkout per repository. A linked worktree whose main checkout is also in the folder
 * is folded into it, because both share the same history; Aiden looks at the branches checked out
 * in worktrees from the main checkout. A worktree whose main checkout is elsewhere is kept.
 */
async function foldWorktrees(
  repositories: Project['repositories'],
  rootPath: string,
  warnings: Set<string>,
): Promise<Project['repositories']> {
  const dirs = await Promise.all(
    repositories.map(async (repo) => {
      try {
        const [common, own] = (await git(repo.path, ['rev-parse', '--git-common-dir', '--git-dir']))
          .trim()
          .split('\n')
          .map((dir) => path.resolve(repo.path, dir.trim()));
        return { repo, common: await realpath(common!), main: common === own };
      } catch {
        return { repo, common: repo.path, main: true };
      }
    }),
  );
  return dirs
    .filter((entry) => {
      if (entry.main) return true;
      const main = dirs.find((other) => other.main && other.common === entry.common);
      if (!main) return true;
      /** A folder's path relative to the chosen folder. */
      const label = (location: string) => path.relative(rootPath, location) || '.';
      warnings.add(
        `${label(entry.repo.path)} is a worktree of ${label(main.repo.path)}, so Aiden looks at it through ${label(main.repo.path)}.`,
      );
      return false;
    })
    .map((entry) => entry.repo);
}

/** Resource bounds for discovery; warnings preserve visibility when a scan is truncated. */
interface DiscoveryLimits {
  maxDepth: number;
  maxDirectories: number;
  maxRepositories: number;
}

/** Queue eligible child folders without following links or exceeding the scan’s resource bounds. */
function enqueueChildren(
  entries: Dirent[],
  location: string,
  depth: number,
  limits: DiscoveryLimits,
  visited: number,
  pending: { location: string; depth: number }[],
  warnings: Set<string>,
): number {
  let skipped = 0;
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    if (entry.isSymbolicLink()) {
      skipped++;
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || excluded.has(entry.name)) {
      skipped++;
      continue;
    }
    if (depth >= limits.maxDepth) {
      warnings.add(
        `Discovery is limited to ${limits.maxDepth} folder levels. Deeper repositories were not checked.`,
      );
    } else if (visited + pending.length >= limits.maxDirectories) {
      warnings.add(
        `Discovery is limited to ${limits.maxDirectories} folders. Some repositories may be missing.`,
      );
    } else {
      pending.push({ location: path.join(location, entry.name), depth: depth + 1 });
    }
  }
  return skipped;
}

/** Make skipped and empty discovery results explicit so users can correct the selected root. */
function summarizeScan(skipped: number, repositoryCount: number, warnings: Set<string>): void {
  if (skipped)
    warnings.add(
      'Hidden, dependency, generated, and linked folders were skipped. Repositories inside them are not included.',
    );
  if (!repositoryCount)
    warnings.add(
      'No Git repositories with commits were found. Choose a repository or a folder containing your project’s repositories.',
    );
}
