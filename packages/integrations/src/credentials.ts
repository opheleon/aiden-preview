import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod';

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

  /** Keep the historical service identity so upgrades can read existing integration credentials. */
  constructor(
    private allowKeyring = true,
    private createEntry: (id: string) => CredentialEntry = (id) =>
      new AsyncEntry('com.opheleon.aiden.mcp', id),
  ) {}

  /** Return validated credentials, treating missing, corrupt, or inaccessible entries as signed out. */
  async read(id: string): Promise<Secret> {
    const session = this.session.get(id);
    if (session) return structuredClone(session);
    if (!this.allowKeyring) return {};
    try {
      const value = await this.createEntry(id).getPassword();
      return value ? secretSchema.parse(JSON.parse(value)) : {};
    } catch {
      return {};
    }
  }

  /** Store only validated secrets and report whether they survive this process. */
  async write(id: string, value: Secret, sessionOnly = false): Promise<'keyring' | 'session'> {
    const validated = secretSchema.parse(value);
    if (!sessionOnly && this.allowKeyring) {
      try {
        await this.createEntry(id).setPassword(JSON.stringify(validated));
        this.session.delete(id);
        return 'keyring';
      } catch {
        /* The caller must display session-only storage when the OS store fails. */
      }
    }
    this.session.set(id, structuredClone(validated));
    return 'session';
  }

  /** Forget in-memory credentials and best-effort remove the OS entry, even if already absent. */
  async remove(id: string): Promise<void> {
    this.session.delete(id);
    if (!this.allowKeyring) return;
    try {
      await this.createEntry(id).deleteCredential();
    } catch {
      /* Missing or unavailable OS entries are already inaccessible to this session. */
    }
  }
}
