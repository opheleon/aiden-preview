import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { AsyncEntry } from '@napi-rs/keyring';

import {
  type VerificationConfig,
  VerificationConfigSchema,
} from '../../contracts/src/verification.js';
import { atomic, optionalJson } from '../../core/src/storage.js';
import { type CredentialEntry, SecretVault } from '../../integrations/src/credentials.js';

const secretsSchema = VerificationConfigSchema.pick({
  credentials: true,
  credentialOrigin: true,
  apiKey: true,
  expiredToken: true,
});
/** Native entry factory, replaceable by credential-free test adapters. */
export const projectCredentialEntries = {
  /** Isolate project secrets from shared tracker connections. */
  create(id: string): CredentialEntry {
    return new AsyncEntry('Aiden project credentials', id);
  },
};
const vault = new SecretVault(true, (id) => projectCredentialEntries.create(id));
const pending = new Map<string, Promise<unknown>>();
/** Serialize migration, settings changes, and cleanup within the owning worker. */
async function exclusive<T>(projectDir: string, operation: () => Promise<T>): Promise<T> {
  const key = identity(projectDir);
  const prior = pending.get(key) ?? Promise.resolve();
  const result = prior.catch(() => {}).then(operation);
  pending.set(key, result);
  try {
    return await result;
  } finally {
    if (pending.get(key) === result) pending.delete(key);
  }
}
/** Track OS writes independently so a failed settings write cannot orphan a credential record. */
async function nativeRecord(projectDir: string): Promise<boolean> {
  const state = await optionalJson<{ keyring?: boolean }>(
    path.join(projectDir, 'verification-credential-state.json'),
  );
  return state?.keyring === true;
}
/** Persist only a cleanup marker, never a credential value. */
async function markNative(projectDir: string, keyring: boolean): Promise<void> {
  await atomic(path.join(projectDir, 'verification-credential-state.json'), { keyring });
}

/** Bind a credential record to its local project and profile without putting a path in Keychain. */
function identity(projectDir: string): string {
  return createHash('sha256').update(path.resolve(projectDir)).digest('hex');
}
/** Read validated metadata without accessing the OS store. Legacy secrets are migration inputs only. */
async function metadata(projectDir: string): Promise<VerificationConfig> {
  const file = path.join(projectDir, 'verification.json');
  let raw: unknown;
  try {
    raw = await optionalJson(file);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`${file} is not valid JSON.`, { cause: error });
    throw error;
  }
  const config = VerificationConfigSchema.parse(raw ?? {});
  if (hasSecrets(config) && ((await stat(file)).mode & 0o077) !== 0)
    throw new Error(`Run chmod 600 on ${file} before migrating test credentials.`);
  return config;
}
/** Distinguish actual secrets from public origin bindings and storage metadata. */
function hasSecrets(config: VerificationConfig): boolean {
  return !!(config.credentials || config.apiKey || config.expiredToken);
}
/** Remove all credential values before serializing project settings. */
function publicConfig(config: VerificationConfig): VerificationConfig {
  const result = structuredClone(config);
  delete result.credentials;
  delete result.credentialOrigin;
  delete result.apiKey;
  delete result.expiredToken;
  return result;
}
/** Restore secrets only to worker memory; a session-only marker never reads the OS store. */
async function hydrate(
  projectDir: string,
  config: VerificationConfig,
): Promise<VerificationConfig> {
  if (!config.credentialStorage) return config;
  const stored = await vault.read(identity(projectDir), config.credentialStorage === 'session');
  if (!stored.bearer) return publicConfig(config);
  try {
    return { ...config, ...secretsSchema.parse(JSON.parse(stored.bearer)) };
  } catch {
    // Treat a corrupt private payload as unavailable so the form can replace or remove it.
    return publicConfig(config);
  }
}
/** Migrate legacy plaintext on first use, then return credentials exclusively in worker memory. */
export async function readProjectVerification(projectDir: string): Promise<VerificationConfig> {
  return exclusive(projectDir, () => readSaved(projectDir));
}
/** Load or migrate while holding the credential operation queue. */
async function readSaved(projectDir: string): Promise<VerificationConfig> {
  const saved = await metadata(projectDir);
  if (hasSecrets(saved)) {
    await persist(projectDir, saved);
    return hydrate(projectDir, await metadata(projectDir));
  }
  return hydrate(projectDir, saved);
}
/**
 * Save only metadata to disk. Unavailable OS storage falls back to memory and is reported publicly.
 * Deletion failures leave the old metadata available for retry instead of claiming secrets are gone.
 */
export async function persistProjectVerification(
  projectDir: string,
  config: VerificationConfig,
): Promise<void> {
  return exclusive(projectDir, () => persist(projectDir, config));
}
/** Commit a secret change while retaining enough metadata to retry incomplete cleanup. */
async function persist(projectDir: string, config: VerificationConfig): Promise<void> {
  const previous = await metadata(projectDir);
  const id = identity(projectDir);
  const next = publicConfig(config);
  const payload = secretsSchema.parse(privateFields(config));
  const old = await hydrate(projectDir, previous);
  const unchanged =
    JSON.stringify(secretsSchema.parse(privateFields(old))) === JSON.stringify(payload) &&
    (previous.rememberCredentials !== false) === (config.rememberCredentials !== false) &&
    !!previous.credentialStorage;
  if (unchanged) next.credentialStorage = previous.credentialStorage!;
  else {
    const native = previous.credentialStorage === 'keyring' || (await nativeRecord(projectDir));
    if (previous.credentialStorage || native) {
      await vault.remove(id, native);
      await markNative(projectDir, false);
    }
    delete next.credentialStorage;
    if (hasSecrets(config)) {
      await markNative(projectDir, config.rememberCredentials !== false);
      next.credentialStorage = await vault.write(
        id,
        { bearer: JSON.stringify(payload) },
        config.rememberCredentials === false,
      );
      await markNative(projectDir, next.credentialStorage === 'keyring');
    }
  }
  await atomic(path.join(projectDir, 'verification.json'), next);
}
/** Select credential fields without allowing public configuration into the secret record. */
function privateFields(config: VerificationConfig) {
  return {
    ...(config.credentials ? { credentials: config.credentials } : {}),
    ...(config.credentialOrigin ? { credentialOrigin: config.credentialOrigin } : {}),
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.expiredToken ? { expiredToken: config.expiredToken } : {}),
  };
}
/** Clear project-only secrets without touching shared connections or the user's environment. */
export async function forgetProjectCredentials(projectDir: string): Promise<void> {
  return exclusive(projectDir, () => forget(projectDir));
}
/** Forget under the queue; an OS failure leaves cleanup metadata intact for another attempt. */
async function forget(projectDir: string): Promise<void> {
  const saved = await metadata(projectDir);
  const native = saved.credentialStorage === 'keyring' || (await nativeRecord(projectDir));
  if (saved.credentialStorage || native) {
    await vault.remove(identity(projectDir), native);
    await markNative(projectDir, false);
  }
  const cleared = publicConfig(saved);
  delete cleared.credentialStorage;
  cleared.credentialsForgotten = true;
  cleared.authRevision = randomUUID();
  await atomic(path.join(projectDir, 'verification.json'), cleared);
}
