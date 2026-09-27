import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  type ExternalReadReceipt,
  type McpAuth,
  type McpConnection,
  McpConnectionSchema,
  type McpTool,
} from '../../contracts/src/index.js';
import { atomic, hash, optionalJson, uid } from '../../core/src/storage.js';
import { SecretVault } from './credentials.js';
import { StoredOAuthProvider } from './oauth.js';
import { assessTool, toolFingerprint } from './tool-policy.js';
export { assessTool, toolFingerprint } from './tool-policy.js';

type Active = { client: Client; transport: Transport; provider?: StoredOAuthProvider };

/** Own hosted MCP sessions, persisted connection metadata, and explicit read-tool consent. */
export class ConnectionManager {
  private file: string;
  private vault: SecretVault;
  private active = new Map<string, Active>();
  private callbacks = new Map<string, Server>();
  /** Use the application data root; tests may opt out of the operating-system credential store. */
  constructor(
    public root: string,
    options: { keyring?: boolean } = {},
  ) {
    this.file = path.join(root, 'integrations', 'connections.json');
    this.vault = new SecretVault(options.keyring !== false);
  }
  /** Load saved connection metadata; malformed storage is surfaced to the caller. */
  async list(): Promise<McpConnection[]> {
    return (await optionalJson<McpConnection[]>(this.file)) ?? [];
  }
  /** Validate and atomically replace one connection while preserving the other records. */
  private async save(connection: McpConnection): Promise<McpConnection> {
    const rows = await this.list();
    const index = rows.findIndex((row) => row.id === connection.id);
    if (index >= 0) rows[index] = McpConnectionSchema.parse(connection);
    else rows.push(McpConnectionSchema.parse(connection));
    await atomic(this.file, rows);
    return connection;
  }
  /** Resolve a saved connection or reject a stale identifier. */
  async get(id: string): Promise<McpConnection> {
    const value = (await this.list()).find((row) => row.id === id);
    if (!value) throw new Error('MCP connection not found.');
    return value;
  }
  /** Save a new disconnected connection, keeping bearer credentials exclusively in the vault. */
  async add(input: {
    name: string;
    provider: 'linear' | 'custom';
    url: string;
    auth: McpAuth;
    bearer?: string;
    clientId?: string;
    sessionOnly?: boolean;
  }): Promise<McpConnection> {
    const now = new Date().toISOString();
    const connection: McpConnection = McpConnectionSchema.parse({
      id: uid(),
      name: input.name,
      provider: input.provider,
      url: input.url,
      auth: input.auth,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      transport: 'streamable-http',
      status: 'disconnected',
      secureStorage: input.auth === 'none' ? 'none' : 'session',
      approvedTools: [],
      createdAt: now,
      updatedAt: now,
    });
    if (input.auth === 'bearer') {
      if (!input.bearer) throw new Error('A bearer token is required.');
      connection.secureStorage = await this.vault.write(
        connection.id,
        { bearer: input.bearer },
        input.sessionOnly,
      );
    }
    await this.save(connection);
    return connection;
  }
  /** Construct the selected HTTP transport with only this connection’s credentials. */
  private async transport(
    connection: McpConnection,
    oauth?: StoredOAuthProvider,
  ): Promise<Transport> {
    const secret = await this.vault.read(connection.id);
    const headers = new Headers();
    if (connection.auth === 'bearer') {
      if (!secret.bearer)
        throw new Error('This connection has no stored bearer token. Reconnect it.');
      headers.set('Authorization', `Bearer ${secret.bearer}`);
    }
    const options = {
      ...(connection.auth === 'bearer' ? { requestInit: { headers } } : {}),
      ...(oauth ? { authProvider: oauth } : {}),
    };
    if (connection.transport === 'sse')
      return new SSEClientTransport(new URL(connection.url), options);
    // The SDK implementation exposes optional fields as explicit undefined.
    // This assertion bridges its own Transport interface under exact optional types.
    return new StreamableHTTPClientTransport(new URL(connection.url), options) as Transport;
  }
  /** Replace any existing client and initialize a fresh MCP session; connection errors propagate. */
  private async connectClient(
    connection: McpConnection,
    oauth?: StoredOAuthProvider,
  ): Promise<Client> {
    const existing = this.active.get(connection.id);
    if (existing) {
      try {
        await existing.client.close();
      } catch {
        // A broken old transport must not prevent an explicit reconnection.
      }
      this.active.delete(connection.id);
    }
    if (connection.auth === 'oauth' && !oauth)
      oauth = new StoredOAuthProvider(
        connection,
        this.vault,
        'http://127.0.0.1/oauth/callback',
        randomBytes(32).toString('base64url'),
      );
    const client = new Client({ name: 'aiden', version: '0.1.0' }, { capabilities: {} });
    const transport = await this.transport(connection, oauth);
    this.active.set(connection.id, { client, transport, ...(oauth ? { provider: oauth } : {}) });
    await client.connect(transport);
    return client;
  }
  /** Start a state-checked loopback callback that expires after five minutes without retrying auth. */
  private async startCallback(connection: McpConnection, state: string): Promise<string> {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
        if (url.pathname !== '/oauth/callback') {
          response.writeHead(404).end('Not found');
          return;
        }
        const code = url.searchParams.get('code');
        if (!code || url.searchParams.get('state') !== state) {
          response
            .writeHead(400, { 'content-type': 'text/plain' })
            .end('Aiden rejected this authorization response. You can close this window.');
          return;
        }
        try {
          const active = this.active.get(connection.id);
          if (!active || !active.provider || !('finishAuth' in active.transport))
            throw new Error('Authorization session expired.');
          await (active.transport as StreamableHTTPClientTransport | SSEClientTransport).finishAuth(
            code,
          );
          await this.connectClient(connection, active.provider);
          connection.status = 'connected';
          connection.message =
            'Connected. Review the available read tools before using this server.';
          connection.updatedAt = new Date().toISOString();
          await this.refreshTools(connection);
          response
            .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end(
              '<!doctype html><title>Aiden connected</title><p>Connection complete. You can return to Aiden.</p>',
            );
        } catch (error) {
          connection.status = 'failed';
          connection.message = error instanceof Error ? error.message : 'OAuth completion failed.';
          connection.updatedAt = new Date().toISOString();
          await this.save(connection);
          response
            .writeHead(500, { 'content-type': 'text/plain' })
            .end('Aiden could not complete this connection. Return to Aiden for details.');
        } finally {
          clearTimeout(timer);
          server.close();
          this.callbacks.delete(connection.id);
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.callbacks.set(connection.id, server);
    const timer = setTimeout(
      () => {
        server.close();
        this.callbacks.delete(connection.id);
        void (async () => {
          const current = await this.get(connection.id).catch(() => null);
          if (current?.status === 'authorization_required') {
            current.status = 'failed';
            current.message = 'Browser authorization expired. Select Connect / test to try again.';
            current.updatedAt = new Date().toISOString();
            await this.save(current);
          }
        })();
      },
      5 * 60 * 1000,
    );
    timer.unref();
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not start the OAuth callback.');
    return `http://127.0.0.1:${address.port}/oauth/callback`;
  }
  /** Test a connection, returning a browser URL when OAuth requires user interaction. */
  async connect(id: string): Promise<{ connection: McpConnection; authUrl: string | undefined }> {
    const connection = await this.get(id);
    connection.status = 'connecting';
    connection.message = undefined;
    connection.updatedAt = new Date().toISOString();
    await this.save(connection);
    let provider: StoredOAuthProvider | undefined;
    if (connection.auth === 'oauth') {
      const state = randomBytes(32).toString('base64url');
      const redirect = await this.startCallback(connection, state);
      provider = new StoredOAuthProvider(connection, this.vault, redirect, state);
    }
    try {
      await this.connectClient(connection, provider);
      connection.status = 'connected';
      connection.message = 'Connected. Review the available read tools before using this server.';
      connection.updatedAt = new Date().toISOString();
      await this.refreshTools(connection);
      return { connection, authUrl: undefined };
    } catch (error) {
      if (provider?.authorizationUrl && error instanceof UnauthorizedError) {
        connection.status = 'authorization_required';
        connection.message = 'Complete authorization in your browser.';
        connection.updatedAt = new Date().toISOString();
        await this.save(connection);
        return { connection, authUrl: provider.authorizationUrl.toString() };
      }
      if (connection.transport === 'streamable-http' && !(error instanceof UnauthorizedError)) {
        try {
          connection.transport = 'sse';
          provider = provider ?? undefined;
          await this.connectClient(connection, provider);
          connection.status = 'connected';
          connection.message =
            'Connected through the legacy HTTP/SSE transport. Review the available read tools.';
          connection.updatedAt = new Date().toISOString();
          await this.refreshTools(connection);
          return { connection, authUrl: undefined };
        } catch {
          connection.transport = 'streamable-http';
        }
      }
      this.callbacks.get(id)?.close();
      this.callbacks.delete(id);
      connection.status = 'failed';
      connection.message = error instanceof Error ? error.message : 'Connection failed.';
      connection.updatedAt = new Date().toISOString();
      await this.save(connection);
      throw new Error(connection.message, { cause: error });
    }
  }
  /** Discover current contracts and revoke all approvals if their fingerprint changes. */
  async refreshTools(connectionOrId: McpConnection | string): Promise<McpTool[]> {
    const connection =
      typeof connectionOrId === 'string' ? await this.get(connectionOrId) : connectionOrId;
    let client = this.active.get(connection.id)?.client;
    if (!client) client = await this.connectClient(connection);
    const result = await client.listTools();
    const tools = result.tools.map((tool) => assessTool(tool, connection.approvedTools));
    const fingerprint = toolFingerprint(tools);
    if (connection.toolFingerprint && connection.toolFingerprint !== fingerprint) {
      connection.approvedTools = [];
      connection.status = 'needs_review';
      connection.message =
        'The server changed its tool definitions. Review and select read tools again.';
    }
    connection.toolFingerprint = fingerprint;
    connection.lastTestedAt = new Date().toISOString();
    connection.updatedAt = connection.lastTestedAt;
    await this.save(connection);
    return tools.map((tool) => ({
      ...tool,
      approved: connection.approvedTools.includes(tool.name) && tool.readOnly,
    }));
  }
  /** Grant consent only to reviewed read tools whose definitions still match the displayed fingerprint. */
  async approve(id: string, names: string[], expectedFingerprint: string): Promise<McpConnection> {
    const connection = await this.get(id);
    const tools = await this.refreshTools(connection);
    if (connection.toolFingerprint !== expectedFingerprint)
      throw new Error('Tool definitions changed. Review them again.');
    const allowed = new Set(tools.filter((tool) => tool.readOnly).map((tool) => tool.name));
    if (names.some((name) => !allowed.has(name)))
      throw new Error('Only recognized read tools can be approved.');
    connection.approvedTools = [...new Set(names)].sort();
    connection.status = 'connected';
    connection.message = `${connection.approvedTools.length} read tool${connection.approvedTools.length === 1 ? '' : 's'} approved.`;
    connection.updatedAt = new Date().toISOString();
    await this.save(connection);
    return connection;
  }
  /** Revalidate consent immediately before a cancellable read and return a content-hashed receipt. */
  async call(
    id: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ result: Awaited<ReturnType<Client['callTool']>>; receipt: ExternalReadReceipt }> {
    const connection = await this.get(id);
    if (!connection.approvedTools.includes(tool))
      throw new Error('This external tool is not approved.');
    const tools = await this.refreshTools(connection);
    if (
      !tools.some(
        (candidate) => candidate.name === tool && candidate.readOnly && candidate.approved,
      )
    )
      throw new Error('This external tool is no longer an approved read operation.');
    const client = this.active.get(id)?.client ?? (await this.connectClient(connection));
    const result = await client.callTool(
      { name: tool, arguments: args },
      undefined,
      signal ? { signal } : {},
    );
    const serialized = JSON.stringify(result);
    if (serialized.length > 5_000_000)
      throw new Error('External tool result exceeded the 5 MB limit.');
    const receipt: ExternalReadReceipt = {
      connectionId: id,
      tool,
      argumentsHash: hash(args),
      resultHash: hash(result),
      calledAt: new Date().toISOString(),
      recordCount: Array.isArray(result.structuredContent) ? result.structuredContent.length : 1,
    };
    return { result, receipt };
  }
  /** Close active transports and callbacks, preserving credentials for a later explicit connection. */
  async disconnect(id: string): Promise<McpConnection> {
    const active = this.active.get(id);
    if (active) {
      await active.client.close().catch(() => {});
      this.active.delete(id);
    }
    this.callbacks.get(id)?.close();
    this.callbacks.delete(id);
    const connection = await this.get(id);
    connection.status = 'disconnected';
    connection.message = 'Disconnected.';
    connection.updatedAt = new Date().toISOString();
    return this.save(connection);
  }
  /** Remove saved metadata and credentials after best-effort session shutdown. */
  async remove(id: string): Promise<{ removed: boolean }> {
    await this.disconnect(id).catch(() => {});
    const rows = (await this.list()).filter((row) => row.id !== id);
    await atomic(this.file, rows);
    await this.vault.remove(id);
    return { removed: true };
  }
  /** Best-effort shutdown of active sessions when the worker exits. */
  async dispose(): Promise<void> {
    for (const id of [...this.active.keys()]) await this.disconnect(id).catch(() => {});
  }
}

export const LINEAR_READONLY_MCP_URL = 'https://mcp.linear.app/mcp/readonly';
