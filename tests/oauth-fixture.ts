import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { type CredentialEntry, SecretVault } from '../packages/integrations/src/credentials.js';

/** Synthetic OS credential store, shared across vault instances without touching real credentials. */
export function persistentVault() {
  const records = new Map<string, string>();
  const state = { locked: false };
  const entry = (id: string): CredentialEntry => ({
    getPassword: () => Promise.resolve(records.get(id)),
    setPassword: (value: string) => {
      if (state.locked) return Promise.reject(new Error('Synthetic locked credential store'));
      records.set(id, value);
      return Promise.resolve();
    },
    deleteCredential: () => Promise.resolve(records.delete(id)),
  });
  return { records, state, open: () => new SecretVault(true, entry) };
}

/** Real HTTP OAuth/MCP fixture. Exercises SDK refresh behavior using only invented credentials. */
export async function oauthFixture() {
  let origin = '';
  const state = {
    access: 'access-1',
    refresh: 'refresh-1',
    refreshes: 0,
    revoked: false,
    lostSession: false,
    initializations: 0,
  };
  const server = createServer((request, response) => {
    void (async () => {
      const route = request.url!;
      const json = (value: unknown, status = 200) =>
        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify(value));
      if (route.startsWith('/.well-known/oauth-protected-resource')) {
        json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
        return;
      }
      if (route.startsWith('/.well-known/oauth-authorization-server')) {
        json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
        return;
      }
      let body = '';
      for await (const part of request) body += part;
      if (route === '/token') {
        const form = new URLSearchParams(body);
        assert.equal(form.get('grant_type'), 'refresh_token');
        assert.equal(form.get('refresh_token'), state.refresh);
        assert.equal(form.get('client_id'), 'synthetic-client');
        state.refreshes++;
        if (state.revoked) {
          json({ error: 'invalid_grant' }, 400);
          return;
        }
        state.access = `access-${state.refreshes + 1}`;
        state.refresh = `refresh-${state.refreshes + 1}`;
        json({
          access_token: state.access,
          refresh_token: state.refresh,
          token_type: 'Bearer',
          expires_in: 3600,
        });
        return;
      }
      if (route !== '/mcp') {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${state.access}`) {
        response
          .writeHead(401, {
            'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          })
          .end();
        return;
      }
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      const message = JSON.parse(body);
      if (message.method === 'initialize') {
        state.initializations++;
        json({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'synthetic-oauth', version: '1' },
          },
        });
        return;
      }
      if (message.method === 'tools/list') {
        if (state.lostSession) {
          state.lostSession = false;
          response.writeHead(404).end();
          return;
        }
        json({ jsonrpc: '2.0', id: message.id, result: { tools: [] } });
        return;
      }
      response.writeHead(202).end();
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    state,
    url: `${origin}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
