import { type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { type McpConnection } from '../../contracts/src/index.js';
import { SecretVault } from './credentials.js';
/** Bridges MCP OAuth to the credential vault; secrets never enter connection metadata. */
export class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  /** Bind credentials and PKCE state to one connection and loopback authorization session. */
  constructor(
    private connection: McpConnection,
    private vault: SecretVault,
    public redirectUrl: string,
    private oauthState: string,
  ) {}
  /** Describe the public desktop client and its current loopback redirect. */
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Aiden Desktop',
      client_uri: 'https://opheleon.com',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  /** Return the unpredictable state used to reject unrelated browser callbacks. */
  state(): string {
    return this.oauthState;
  }
  /** Prefer an explicitly configured client ID; otherwise load the registered client securely. */
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.connection.clientId) return { client_id: this.connection.clientId };
    return (await this.vault.read(this.connection.id)).clientInformation;
  }
  /** Persist registration without replacing tokens or PKCE state; vault failures propagate. */
  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    const current = await this.vault.read(this.connection.id);
    await this.vault.write(
      this.connection.id,
      { ...current, clientInformation: value },
      this.connection.secureStorage === 'session',
    );
  }
  /** Read tokens only from the configured vault or session fallback. */
  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.vault.read(this.connection.id)).tokens;
  }
  /** Replace tokens and record whether secure persistence or session storage was available. */
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const current = await this.vault.read(this.connection.id);
    const storage = await this.vault.write(
      this.connection.id,
      { ...current, tokens },
      this.connection.secureStorage === 'session',
    );
    this.connection.secureStorage = storage;
  }
  /** Capture the authorization destination for the desktop to open in the user’s browser. */
  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }
  /** Retain the PKCE verifier with this connection’s credentials until callback completion. */
  async saveCodeVerifier(verifier: string): Promise<void> {
    const current = await this.vault.read(this.connection.id);
    await this.vault.write(
      this.connection.id,
      { ...current, verifier },
      this.connection.secureStorage === 'session',
    );
  }
  /** Recover the PKCE verifier; an expired session requires explicit reconnection. */
  async codeVerifier(): Promise<string> {
    const value = (await this.vault.read(this.connection.id)).verifier;
    if (!value) throw new Error('OAuth code verifier is unavailable. Reconnect the server.');
    return value;
  }
  /** Revoke only the requested credential scope; discovery has no locally cached secret. */
  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'all') return this.vault.remove(this.connection.id);
    const current = await this.vault.read(this.connection.id);
    if (scope === 'tokens') delete current.tokens;
    if (scope === 'client') delete current.clientInformation;
    if (scope === 'verifier') delete current.verifier;
    await this.vault.write(
      this.connection.id,
      current,
      this.connection.secureStorage === 'session',
    );
  }
}
