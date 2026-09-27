import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { id, safeRelative } from '../../contracts/src/index.js';

/** Hash a serializable contract for change detection; object insertion order is significant. */
export const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Generate a collision-resistant identifier for a run, baseline, or stored artifact. */
export const uid = (): string => randomUUID();
/** Decode JSON from disk; callers must validate persisted contracts before trusting their shape. */
export async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}
/** Treat only a missing file as absent; corruption and permission failures remain visible. */
export async function optionalJson<T>(file: string): Promise<T | null> {
  try {
    return await json<T>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
/** Atomically replace JSON with owner-only permissions; cancellation preserves the previous file. */
export async function atomic(file: string, value: unknown, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error('Cannot persist an undefined JSON value.');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serialized + '\n', { mode: 0o600, flag: 'wx' });
    signal?.throwIfAborted();
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
/** Resolve an artifact beneath its canonical root and reject every existing symlink component. */
export async function boundedPath(root: string, relative: string): Promise<string> {
  if (!safeRelative(relative)) throw new Error('Unsafe artifact path.');
  const base = await realpath(root);
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Symlink artifact paths are forbidden.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
/** Locate version-compatible project and run directories without accepting path fragments as IDs. */
export class Store {
  /** Use the supplied isolated root, or the existing Aiden home for normal application startup. */
  constructor(public root = process.env.AIDEN_HOME || path.join(homedir(), '.aiden')) {}
  /** Validate the project ID before deriving its storage location. */
  project(projectId: string): string {
    return path.join(this.root, 'projects', id.parse(projectId));
  }
  /** Validate both IDs before deriving a run's storage location. */
  run(projectId: string, runId: string): string {
    return path.join(this.project(projectId), 'runs', id.parse(runId));
  }
  /** List valid stored run names; a new project has no runs, while I/O failures remain errors. */
  async listRuns(projectId: string): Promise<string[]> {
    const directory = path.join(this.project(projectId), 'runs');
    try {
      return (await readdir(directory)).filter((name) => id.safeParse(name).success);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
