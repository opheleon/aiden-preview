import { createServer } from 'node:http';

/** One loopback authorization attempt, closed after completion, replacement, expiry, or shutdown. */
export interface OAuthCallback {
  url: string;
  close(): void;
}

/** Accept a matching OAuth state once; delegate credential handling without exposing it in HTTP errors. */
export async function oauthCallback(
  state: string,
  complete: (code: string) => Promise<void>,
  expired: () => Promise<void>,
): Promise<OAuthCallback> {
  let consumed = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth/callback') {
      response.writeHead(404).end('Not found');
      return;
    }
    const code = url.searchParams.get('code');
    if (consumed || !code || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Aiden rejected this authorization response.');
      return;
    }
    consumed = true;
    void complete(code)
      .then(() => {
        response
          .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(
            '<!doctype html><title>Aiden connected</title><p>Connection complete. Return to Aiden.</p>',
          );
      })
      .catch(() => {
        response.writeHead(500).end('Aiden could not complete this connection. Return to Aiden.');
      })
      .finally(close);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const timer = setTimeout(
    () => {
      close();
      void expired().catch(() => {});
    },
    5 * 60 * 1000,
  );
  timer.unref();
  /** Release the callback listener and its expiry timer, including on non-interactive refresh. */
  function close(): void {
    clearTimeout(timer);
    server.close();
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    close();
    throw new Error('Could not start the OAuth callback.');
  }
  return { url: `http://127.0.0.1:${address.port}/oauth/callback`, close };
}
