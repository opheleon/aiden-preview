import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod/v3';

import { atomic, optionalJson } from '../../core/src/storage.js';
import type { CredentialEntry } from './credentials.js';

const StoredSchema = z.object({ password: z.string() }).strict();

/**
 * One credential kept as an owner-only file under `AIDEN_HOME/credentials`, for machines with no
 * OS credential store, such as a Linux container on Fly.io. The file name is a hash of the service
 * and id, so neither appears on disk; the folder is 0700 and each file 0600.
 */
export class FileCredentialEntry implements CredentialEntry {
  private readonly file: string;

  /**
   * Bind the entry to its file.
   * @param root Aiden data folder that holds the `credentials` folder.
   * @param service Credential namespace, the same one the OS store would use.
   * @param id Entry name within the namespace.
   */
  constructor(root: string, service: string, id: string) {
    const name = createHash('sha256').update(`${service}\0${id}`).digest('hex');
    this.file = path.join(root, 'credentials', `${name}.json`);
  }

  /** The saved value, or undefined when nothing is saved; a corrupt file reads as absent. */
  async getPassword(): Promise<string | undefined> {
    const parsed = StoredSchema.safeParse(await optionalJson(this.file).catch(() => null));
    return parsed.success ? parsed.data.password : undefined;
  }

  /** Replace the value atomically with owner-only permissions. */
  async setPassword(password: string): Promise<void> {
    await atomic(this.file, { password });
  }

  /** Remove the file; reports whether one existed, as the OS store does. */
  async deleteCredential(): Promise<boolean> {
    try {
      await rm(this.file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

/**
 * The credential entry for a service and id: the OS store by default, or an owner-only file when
 * `AIDEN_CREDENTIAL_STORE=file`. Any other non-empty value is refused, so a typo never silently
 * falls back to session-only storage.
 * Example: `credentialEntry('com.opheleon.aiden.mcp', 'linear')`.
 */
export function credentialEntry(
  service: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): CredentialEntry {
  const store = env.AIDEN_CREDENTIAL_STORE?.trim();
  if (store === 'file')
    return new FileCredentialEntry(env.AIDEN_HOME || path.join(homedir(), '.aiden'), service, id);
  if (store && store !== 'keyring')
    throw new Error('AIDEN_CREDENTIAL_STORE must be keyring or file.');
  return new AsyncEntry(service, id);
}
