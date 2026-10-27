import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { z } from 'zod/v3';

import type { TeamsAuthConfig } from '../../../contracts/src/teams-auth.js';
import type { AccountSession } from './session.js';

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
});
/** Refresh this long before expiry so a request never carries a token about to lapse. */
const earlyMs = 60_000;
/** A sign-in left open in the browser stops waiting after this long. */
const signInMs = 5 * 60 * 1000;

/** Base64url without padding, as PKCE requires. */
const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** What the browser shows after the redirect; the page carries nothing sensitive. */
function page(message: string): string {
  const text = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>Aiden</title><body style="font-family:system-ui;padding:48px"><h1>Aiden</h1><p>${text}</p></body>`;
}

/** A sign-in the account server turned away, with the reason to show the person. */
class NotAdmitted extends Error {}

/** A sign-in waiting for the browser redirect. */
interface Pending {
  state: string;
  close: () => void;
}

/**
 * Teams sign-in with Auth0: authorization code with PKCE through the system browser and a
 * loopback redirect (RFC 8252). The refresh token lives in the keychain; access tokens live only
 * in memory and are refreshed one request at a time, because Auth0 rotates refresh tokens and
 * treats a second use of an old one as theft.
 */
export class TeamsSignIn {
  private access: { token: string; expiresAt: number } | undefined;
  private refreshing: Promise<string | undefined> | undefined;
  private pending: Pending | undefined;
  private failure: string | undefined;
  /**
   * Checks a fresh sign-in with the account server before it is kept: the reason to refuse it,
   * or null to keep it. Example: an email that is not on any team is refused, so the app never
   * holds a sign-in that cannot reach team work.
   */
  admit: (() => Promise<string | null>) | undefined;

  /**
   * Bind configuration and storage.
   * @param config Tenant, client, audience, and loopback ports.
   * @param session Keychain-backed refresh token storage.
   * @param http Fetch implementation, injectable for tests.
   * @param now Clock in milliseconds, injectable for tests.
   */
  constructor(
    private readonly config: TeamsAuthConfig,
    private readonly session: AccountSession,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether a browser sign-in is waiting, and why the last one failed, if it did. */
  progress(): { waiting: boolean; failure: string | null } {
    return { waiting: !!this.pending, failure: this.failure ?? null };
  }

  /** Start a browser sign-in and return the URL to open; the redirect finishes it in the background. */
  async begin(): Promise<{ authUrl: string }> {
    this.pending?.close();
    this.failure = undefined;
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(16));
    const { server, port } = await this.listen();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const timer = setTimeout(() => finish('Sign-in timed out. Try again.'), signInMs);
    timer.unref();
    /** Stop waiting: close the listener and record why, if it failed. */
    const finish = (failure?: string): void => {
      clearTimeout(timer);
      server.close();
      if (this.pending?.state === state) this.pending = undefined;
      if (failure) this.failure = failure;
    };
    this.pending = { state, close: () => finish() };
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (url.pathname !== '/oauth/callback' || url.searchParams.get('state') !== state) {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      /** Answer the browser tab, then stop waiting. */
      const reply = (message: string, failure?: string): void => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(message));
        finish(failure);
      };
      if (!code || url.searchParams.get('error'))
        return reply('Sign-in was cancelled. You can close this tab.', 'Sign-in was cancelled.');
      void this.exchange(code, verifier, redirectUri).then(
        () => reply('You are signed in to Aiden Teams. You can close this tab.'),
        (error: unknown) => {
          const reason =
            error instanceof NotAdmitted
              ? error.message
              : 'Sign-in could not be completed. Try again.';
          reply(`${reason} You can close this tab.`, reason);
        },
      );
    });
    const authorize = new URL('authorize', this.config.issuer);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      audience: this.config.audience,
      resource: this.config.audience,
      scope: 'openid profile email offline_access',
      // Always ask which email to use, so a browser still signed in to another email is not reused.
      prompt: 'login',
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      state,
    }).toString();
    return { authUrl: authorize.toString() };
  }

  /** Listen on the first free registered loopback port. */
  private async listen(): Promise<{ server: Server; port: number }> {
    for (const port of this.config.ports) {
      const server = createServer();
      const bound = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (bound) return { server, port };
    }
    throw new Error('Another sign-in is using the sign-in ports. Close it and try again.');
  }

  /** Trade the authorization code for tokens and keep the refresh token once the server admits it. */
  private async exchange(code: string, verifier: string, redirectUri: string): Promise<void> {
    const tokens = await this.token({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    if (!tokens.refresh_token) throw new Error('Auth0 returned no refresh token.');
    this.remember(tokens);
    const refused = await this.admit?.().catch((error: unknown) => {
      this.access = undefined;
      throw error;
    });
    if (refused) {
      this.access = undefined;
      throw new NotAdmitted(refused);
    }
    await this.session.saveRefresh(tokens.refresh_token);
  }

  /** Call the token endpoint. */
  private async token(body: Record<string, string>): Promise<z.infer<typeof TokenSchema>> {
    const response = await this.http(new URL('oauth/token', this.config.issuer), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, resource: this.config.audience }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const code = z.object({ error: z.string().max(64) }).safeParse(body);
      throw Object.assign(new Error('Token request failed.'), {
        status: response.status,
        code: code.success ? code.data.error : undefined,
      });
    }
    return TokenSchema.parse(await response.json());
  }

  /** Keep a fresh access token in memory. */
  private remember(tokens: z.infer<typeof TokenSchema>): void {
    this.access = { token: tokens.access_token, expiresAt: this.now() + tokens.expires_in * 1000 };
  }

  /** A current access token, refreshing when needed; undefined when signed out. */
  accessToken(): Promise<string | undefined> {
    if (this.access && this.access.expiresAt - earlyMs > this.now())
      return Promise.resolve(this.access.token);
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  /** Force the next request to refresh, for example after the server rejected a token. */
  invalidate(): void {
    this.access = undefined;
  }

  /** Rotate the refresh token; a rejected one means the session is over. */
  private async refresh(): Promise<string | undefined> {
    const current = await this.session.refreshToken();
    if (!current) return undefined;
    try {
      const tokens = await this.token({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: current,
      });
      if (tokens.refresh_token) await this.session.saveRefresh(tokens.refresh_token);
      this.remember(tokens);
      return tokens.access_token;
    } catch (error) {
      const { status, code } = error as { status?: number; code?: string };
      if (status === 400 || status === 401 || status === 403) {
        this.access = undefined;
        this.failure = `Your Teams sign-in ended (Auth0: ${code ?? `HTTP ${status}`}). Sign in again.`;
        await this.session.signOut();
        return undefined;
      }
      throw error;
    }
  }

  /** Revoke the refresh token at Auth0 and forget everything locally. */
  async signOut(): Promise<void> {
    this.pending?.close();
    const current = await this.session.refreshToken();
    if (current)
      await this.http(new URL('oauth/revoke', this.config.issuer), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: this.config.clientId, token: current }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    this.access = undefined;
    await this.session.signOut();
  }
}
