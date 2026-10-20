import { readdir } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'release',
  'coverage',
  '.pnpm-store',
  'test-results',
  'playwright-report',
]);
/** Nested checkouts of other branches, such as agent worktrees, are not this repository's files. */
const ignoredPaths = new Set([path.join('.claude', 'worktrees')]);

/** Enumerate handwritten repository files, including new files not yet staged in Git. */
export async function repositoryFiles(root = '.'): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = path.join(root, entry.name);
    if (ignored.has(entry.name) || ignoredPaths.has(name) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...(await repositoryFiles(name)));
    else files.push(name.replaceAll(path.sep, '/'));
  }
  return files;
}

/** Identify test files and fixtures so source-size rules do not fragment test scenarios. */
export function isTestFile(file: string): boolean {
  return file.startsWith('tests/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/** Count physical lines while treating a terminal newline as a terminator, not another line. */
export function physicalLines(source: string): number {
  return source.length === 0 ? 0 : source.replace(/\r?\n$/, '').split(/\r?\n/).length;
}
