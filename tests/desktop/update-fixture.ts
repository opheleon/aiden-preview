import { once } from 'node:events';
import { createServer } from 'node:http';

import type { ElectronApplication } from '@playwright/test';

// Configure only the running test process. The packaged update configuration stays untouched.
export async function updateFixture(app: ElectronApplication) {
  const version = await app.evaluate(({ app }) => app.getVersion());
  let unavailable = false;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(unavailable ? 503 : 200, { 'Content-Type': 'application/yaml' });
    response.end(
      unavailable
        ? 'Synthetic update feed unavailable'
        : JSON.stringify({
            version,
            files: [{ url: 'synthetic.zip', sha512: Buffer.alloc(64).toString('base64'), size: 1 }],
            releaseDate: '2026-01-01T00:00:00.000Z',
          }),
    );
  });
  server.listen(0, '127.0.0.1');
  server.unref();
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing update fixture port.');
  try {
    await app.evaluate(({ app }, url) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(`${app.getAppPath()}/package.json`);
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
      autoUpdater.setFeedURL({ provider: 'generic', url });
    }, `http://127.0.0.1:${address.port}/`);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    version,
    requests,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
