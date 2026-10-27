import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod/v3';

import { flavorFromEnv } from '../../../contracts/src/app-flavor.js';
import { credentialEntry } from '../../../integrations/src/credential-store.js';
import { type CredentialEntry, SecretVault } from '../../../integrations/src/credentials.js';
import { atomic, optionalJson, type Store } from '../storage.js';

/**
 * Credential entries for the Accounts session; replaced in tests so no real keychain is touched.
 * Aiden Beta signs in to a different tenant, so it keeps its own entries.
 */
export const accountSessionEntries = {
  create: (id: string): CredentialEntry =>
    credentialEntry(
      flavorFromEnv(process.env) === 'beta'
        ? 'com.opheleon.aiden-beta.accounts'
        : 'com.opheleon.aiden.accounts',
      id,
    ),
};
const vault = new SecretVault(true, (id) => accountSessionEntries.create(id));

const PreferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Stable random id for this installation; the server binds it to the first person who signs in. */
    deviceId: z.string().uuid(),
    pickupEnabled: z.boolean(),
    usageCapPct: z.number().int().min(10).max(100),
    email: z.string().optional(),
    userId: z.string().optional(),
  })
  .strict();

/** Non-secret Teams preferences for this machine. */
export type AccountPreferences = z.infer<typeof PreferencesSchema>;

/** Defaults: pick up account work, and stop at 70% of the member's usage window. */
const defaults = (): AccountPreferences => ({
  schemaVersion: 1,
  deviceId: randomUUID(),
  pickupEnabled: true,
  usageCapPct: 70,
});

/**
 * The Teams sign-in on this machine. The session token lives only in the OS keychain, an
 * owner-only credential file on headless Linux (`AIDEN_CREDENTIAL_STORE=file`), or session memory
 * when neither is available; preferences hold nothing secret.
 */
export class AccountSession {
  private readonly file: string;

  /** Bind to the worker's data root. */
  constructor(store: Store) {
    this.file = path.join(store.root, 'preferences', 'account.json');
  }

  /** Keychain entry for this installation, so separate Aiden data folders keep separate sign-ins. */
  private async entry(): Promise<string> {
    return `session-${(await this.preferences()).deviceId}`;
  }

  /** The Auth0 refresh token, or undefined when signed out. */
  async refreshToken(): Promise<string | undefined> {
    return (await vault.read(await this.entry())).bearer || undefined;
  }

  /** Keep the latest refresh token; Auth0 rotates it on every use. */
  async saveRefresh(token: string): Promise<void> {
    await vault.write(await this.entry(), { bearer: token });
  }

  /** Remember who is signed in, for the account screen while offline. */
  async rememberUser(user: { id: string; email: string }): Promise<void> {
    const current = await this.preferences();
    if (current.email !== user.email || current.userId !== user.id)
      await this.update({ email: user.email, userId: user.id });
  }

  /** Saved preferences; a missing or corrupt file starts from defaults with a new device id. */
  async preferences(): Promise<AccountPreferences> {
    const parsed = PreferencesSchema.safeParse(await optionalJson(this.file).catch(() => null));
    if (parsed.success) return parsed.data;
    const fresh = defaults();
    await atomic(this.file, fresh);
    return fresh;
  }

  /** Change preferences, keeping the device id. */
  async update(
    patch: Partial<Omit<AccountPreferences, 'schemaVersion' | 'deviceId'>>,
  ): Promise<AccountPreferences> {
    const next = PreferencesSchema.parse({ ...(await this.preferences()), ...patch });
    await atomic(this.file, next);
    return next;
  }

  /** Forget the refresh token and the signed-in identity. */
  async signOut(): Promise<void> {
    await vault.remove(await this.entry());
    const current = await this.preferences();
    await atomic(this.file, { ...current, email: undefined, userId: undefined });
  }
}
