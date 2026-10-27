import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

/** Wake requests older or newer than this are refused, so a captured one cannot be replayed later. */
const skewSeconds = 300;
/** A wake body is a few dozen bytes. */
const bodyLimit = 4096;
/** Wakes closer together than this only ask for work once. */
const nudgeGapMs = 5_000;

/** Where this machine listens for wakes and the public address the team posts them to. */
export interface WakeSettings {
  port: number;
  url: string;
}

/**
 * Wake settings from the environment, or null when wakes are off. `AIDEN_WAKE_PORT` turns them on;
 * the public address is `AIDEN_WAKE_URL`, or on Fly.io `https://<FLY_APP_NAME>.fly.dev/wake`.
 * Example: `AIDEN_WAKE_PORT=8080 FLY_APP_NAME=dana-aiden-worker` gives
 * `{ port: 8080, url: 'https://dana-aiden-worker.fly.dev/wake' }`.
 */
export function wakeSettings(env: NodeJS.ProcessEnv = process.env): WakeSettings | null {
  const port = Number(env.AIDEN_WAKE_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const url =
    env.AIDEN_WAKE_URL || (env.FLY_APP_NAME ? `https://${env.FLY_APP_NAME}.fly.dev/wake` : '');
  if (!url) return null;
  try {
    return { port, url: new URL(url).href };
  } catch {
    throw new Error(`AIDEN_WAKE_URL is not an address: ${url}`);
  }
}

/** A fresh signing key for this run: 32 random bytes, base64url encoded. */
export function wakeSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * True when a wake request was signed by the team with this machine's key, recently, for this
 * machine. The signature is hex HMAC-SHA256 over `<timestamp>.<body>`.
 * Example headers: `x-aiden-timestamp: 1792508400`, `x-aiden-signature: sha256=5d41...`.
 */
export function verifyWake(
  key: { secret: string; deviceId: string },
  request: { timestamp: string | undefined; signature: string | undefined; body: string },
  now: Date,
): boolean {
  const timestamp = Number(request.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(now.getTime() / 1000 - timestamp) > skewSeconds)
    return false;
  const given = Buffer.from(request.signature?.replace(/^sha256=/, '') ?? '', 'hex');
  const expected = createHmac('sha256', key.secret).update(`${timestamp}.${request.body}`).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const parsed = JSON.parse(request.body) as { type?: unknown; deviceId?: unknown };
    return parsed.type === 'wake' && parsed.deviceId === key.deviceId;
  } catch {
    return false;
  }
}

/** Read a small request body, or null when it is larger than a wake can be. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > bodyLimit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Listen for wakes. On Fly.io, any request to the app starts a stopped machine before it gets
 * here, so starting is the wake itself; a signed `POST /wake` also asks for work at once.
 * `GET /` answers so a person can wake the machine from a browser or with curl.
 * @param options Listener settings.
 * @param options.port Port to listen on, on every interface.
 * @param options.key This run's signing key and device, or null before the team knows them.
 * @param options.onWake Called for each verified wake, at most once every five seconds.
 * @param options.now Clock, injectable for tests.
 */
export async function listenForWakes(options: {
  port: number;
  key: () => { secret: string; deviceId: string } | null;
  onWake: () => void;
  now?: () => Date;
}): Promise<Server> {
  let lastNudge = 0;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === 'GET' && request.url === '/') {
        response
          .writeHead(200, { 'content-type': 'text/plain' })
          .end('Aiden Teams worker is awake.\n');
        return;
      }
      if (request.method !== 'POST' || request.url !== '/wake') {
        response.writeHead(404).end();
        return;
      }
      const body = await readBody(request);
      const key = options.key();
      const now = options.now?.() ?? new Date();
      const valid =
        body !== null &&
        key !== null &&
        verifyWake(
          key,
          {
            timestamp: request.headers['x-aiden-timestamp'] as string | undefined,
            signature: request.headers['x-aiden-signature'] as string | undefined,
            body,
          },
          now,
        );
      if (!valid) {
        response.writeHead(401).end();
        return;
      }
      if (now.getTime() - lastNudge >= nudgeGapMs) {
        lastNudge = now.getTime();
        options.onWake();
      }
      response.writeHead(202).end();
    })().catch(() => response.writeHead(400).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => resolve());
  });
  return server;
}
