import { mkdir } from 'node:fs/promises';

import { z } from 'zod/v3';

import { atomic, boundedPath, json } from '../../../packages/core/src/storage.js';

/** Safe, credential-free state exposed to the desktop guide. */
export interface FirstUseState {
  completed: boolean;
  issue: 'corrupt' | 'unavailable' | null;
}
const CompletionSchema = z
  .object({ schemaVersion: z.literal(1), completedAt: z.string().datetime() })
  .strict();

/** Local workspace completion survives projects, providers and app upgrades; only explicit confirmation writes it. */
export class FirstUsePreferences {
  private saving: Promise<FirstUseState> | undefined;
  /** Bind a trusted application data root, never a renderer-supplied path. */
  constructor(private readonly root: string) {}

  /** Resolve only this preference and reject symlink components before reads or writes. */
  private async file(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return boundedPath(this.root, 'preferences/first-use.json');
  }

  /** Missing state means first use; corrupt or unreadable state stays incomplete with visible recovery. */
  async read(): Promise<FirstUseState> {
    try {
      const value = await json<unknown>(await this.file());
      return CompletionSchema.safeParse(value).success
        ? { completed: true, issue: null }
        : { completed: false, issue: 'corrupt' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { completed: false, issue: null };
      return { completed: false, issue: error instanceof SyntaxError ? 'corrupt' : 'unavailable' };
    }
  }

  /** Coalesce duplicate confirmations and report success only after the atomic write succeeds. */
  complete(): Promise<FirstUseState> {
    this.saving ??= this.persist().finally(() => {
      this.saving = undefined;
    });
    return this.saving;
  }

  /** Preserve existing completion during replay and expose a safe retryable error on storage failure. */
  private async persist(): Promise<FirstUseState> {
    if ((await this.read()).completed) return { completed: true, issue: null };
    try {
      await atomic(await this.file(), { schemaVersion: 1, completedAt: new Date().toISOString() });
      return { completed: true, issue: null };
    } catch {
      throw new Error(
        'Could not save your guide confirmation. Retry, or choose Later and try next time.',
      );
    }
  }
}
