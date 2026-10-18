import { chmod, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { type DemoAccount, DemoDatabase } from './database.js';
import { loginPage, notesPage } from './pages.js';

/** Public disposable credentials for this local example only, never for a real account. */
export const demoAccount: DemoAccount = {
  email: 'demo@local.test',
  password: 'local-demo-password-42',
  apiKey: 'local-demo-api-key-42',
};
/** Read a small request body without letting a client consume unbounded memory. */
async function body(request: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 8192) throw new Error('Request is too large.');
  }
  return text;
}
/** Parse only the app's opaque session cookie; arbitrary cookies are ignored. */
function session(request: IncomingMessage): string {
  return /(?:^|;\s*)aiden_demo=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1] ?? '';
}
/** Send a bounded JSON response without credentials, tokens, or internal errors. */
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}
/** Route real API requests using API-key authentication independently of web cookies. */
async function apiRoute(
  request: IncomingMessage,
  response: ServerResponse,
  db: DemoDatabase,
  route: string,
): Promise<void> {
  const header = request.headers['x-api-key'];
  const key =
    typeof header === 'string'
      ? header
      : (request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? '');
  const user = db.apiUser(key);
  if (!user) {
    json(response, 401, { error: 'A valid API key is required.' });
    return;
  }
  if (request.method === 'GET' && ['/api/', '/api/notes'].includes(route)) {
    json(response, 200, { notes: db.notes(user) });
    return;
  }
  if (request.method === 'POST' && route === '/api/notes') {
    const input: unknown = JSON.parse(await body(request));
    if (!input || typeof input !== 'object' || !('text' in input) || typeof input.text !== 'string')
      throw new Error('Enter note text.');
    db.addNote(user, input.text);
    json(response, 201, { saved: true });
    return;
  }
  json(response, 404, { error: 'Endpoint not found.' });
}
/** Verify the submitted password and create an opaque database-backed session. */
async function signIn(
  request: IncomingMessage,
  response: ServerResponse,
  db: DemoDatabase,
): Promise<void> {
  const form = new URLSearchParams(await body(request));
  const token = db.login(form.get('email') ?? '', form.get('password') ?? '');
  if (!token) {
    response.writeHead(401).end(loginPage(true));
    return;
  }
  response.setHeader(
    'Set-Cookie',
    `aiden_demo=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
  );
  response.writeHead(303, { Location: '/app' }).end();
}
/** Handle server-rendered frontend forms with same-origin checks and database-backed sessions. */
async function webRoute(
  request: IncomingMessage,
  response: ServerResponse,
  db: DemoDatabase,
  route: string,
  origin: string,
): Promise<void> {
  if (request.method === 'POST' && request.headers.origin !== origin) {
    json(response, 403, { error: 'Same-origin form required.' });
    return;
  }
  if (request.method === 'GET' && route === '/login') {
    response.end(loginPage());
    return;
  }
  if (request.method === 'POST' && route === '/login') {
    await signIn(request, response, db);
    return;
  }
  const token = session(request);
  const user = db.user(token);
  if (!user) {
    response.writeHead(303, { Location: '/login' }).end();
    return;
  }
  if (request.method === 'GET' && route === '/app') {
    response.end(notesPage(user.email, db.notes(user.id)));
    return;
  }
  if (request.method === 'POST' && route === '/notes') {
    db.addNote(user.id, new URLSearchParams(await body(request)).get('text') ?? '');
    response.writeHead(303, { Location: '/app' }).end();
    return;
  }
  if (request.method === 'POST' && route === '/logout') {
    db.logout(token);
    response.setHeader('Set-Cookie', 'aiden_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    response.writeHead(303, { Location: '/login' }).end();
    return;
  }
  response.writeHead(404).end('Page not found.');
}
/** Start a loopback-only frontend/backend with its own persistent SQLite database. */
export async function startAuthDemo(
  folder: string,
  port = 0,
  account: DemoAccount = demoAccount,
): Promise<{ origin: string; db: DemoDatabase; close: () => Promise<void> }> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, 'demo.sqlite');
  const db = new DemoDatabase(file, account);
  await chmod(file, 0o600);
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    );
    const route = new URL(request.url ?? '/', 'http://localhost').pathname;
    void (
      route.startsWith('/api/')
        ? apiRoute(request, response, db, route)
        : webRoute(request, response, db, route, origin)
    ).catch(() => {
      json(response, 400, { error: 'Invalid request.' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not start the local test app.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    db,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      db.close();
    },
  };
}
