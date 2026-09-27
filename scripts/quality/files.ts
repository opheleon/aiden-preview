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

/** Enumerate handwritten repository files, including new files not yet staged in Git. */
export async function repositoryFiles(root = '.'): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const name = path.join(root, entry.name);
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
