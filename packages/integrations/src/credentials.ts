import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod';

import { credentialEntry } from './credential-store.js';

const secretSchema = z
  .object({
    bearer: z.string().optional(),
    tokens: OAuthTokensSchema.optional(),
    clientInformation: z
      .union([OAuthClientInformationFullSchema, OAuthClientInformationSchema])
      .optional(),
    verifier: z.string().optional(),
  })
  .strict();

/** Sensitive connection data stored separately from project metadata and source receipts. */
export type Secret = z.infer<typeof secretSchema>;
/** Minimal OS credential-store contract, injectable for failure-path tests. */
export type CredentialEntry = Pick<AsyncEntry, 'getPassword' | 'setPassword' | 'deleteCredential'>;

/** Prefer OS-protected storage; expose a session-only fallback when it is unavailable. */
export class SecretVault {
  private session = new Map<string, Secret>();
  private reads = new Map<string, Promise<Secret>>();
  private unavailable = new Set<string>();

  /** Keep the historical service identity so upgrades can read existing integration credentials. */
  constructor(
    private allowKeyring = true,
    private createEntry: (id: string) => CredentialEntry = (id) =>
      credentialEntry('com.opheleon.aiden.mcp', id),
  ) {}

  /** Return validated credentials, treating missing, corrupt, or inaccessible entries as signed out. */
  async read(id: string, sessionOnly = false): Promise<Secret> {
    const session = this.session.get(id);
    if (session) return structuredClone(session);
    if (sessionOnly || !this.allowKeyring) return {};
    let pending = this.reads.get(id);
    if (!pending) {
      pending = this.readStored(id);
      this.reads.set(id, pending);
    }
    const value = await pending;
    // A write or disconnect may have completed while the OS permission dialog was open.
    return structuredClone(this.session.get(id) ?? (this.reads.get(id) === pending ? value : {}));
  }

  /** Read the OS entry once per worker session; denied access is retried only on explicit connect. */
  private async readStored(id: string): Promise<Secret> {
    try {
      const value = await this.createEntry(id).getPassword();
      if (value) return secretSchema.parse(JSON.parse(value));
    } catch {
      // A dismissed permission request must not trigger another popup on every OAuth callback.
    }
    this.unavailable.add(id);
    return {};
  }

  /** Allow an explicit reconnect to retry a missing or denied entry without discarding live tokens. */
  retryRead(id: string): void {
    if (this.unavailable.delete(id)) this.reads.delete(id);
  }

  /** Store only validated secrets and report whether they survive this process. */
  async write(id: string, value: Secret, sessionOnly = false): Promise<'keyring' | 'session'> {
    const validated = secretSchema.parse(value);
    if (!sessionOnly && this.allowKeyring) {
      try {
        await this.createEntry(id).setPassword(JSON.stringify(validated));
        this.session.set(id, structuredClone(validated));
        this.reads.delete(id);
        this.unavailable.delete(id);
        return 'keyring';
      } catch {
        /* The caller must display session-only storage when the OS store fails. */
      }
    }
    this.session.set(id, structuredClone(validated));
    this.reads.delete(id);
    return 'session';
  }

  /** Forget cached credentials; retain a retryable failure unless OS removal is confirmed. */
  async remove(id: string, persistent = true): Promise<void> {
    if (persistent && this.allowKeyring) await this.removeStored(id);
    this.session.delete(id);
    this.reads.set(id, Promise.resolve({}));
    this.unavailable.delete(id);
  }

  /** Confirm native removal before discarding cached data needed to retry a partial update. */
  private async removeStored(id: string): Promise<void> {
    try {
      const entry = this.createEntry(id);
      // Erase the payload first; an absent entry can then be deleted idempotently.
      await entry.setPassword('{}');
      if (!(await entry.deleteCredential())) throw new Error('Removal unconfirmed');
    } catch {
      throw new Error('Could not remove saved credentials. Unlock secure storage and try again.');
    }
  }
}
