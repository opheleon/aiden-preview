import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { type ElectronApplication, expect } from '@playwright/test';

// Synthetic ZIP bytes exercise transport and SHA-512 checks, never native installation.
export async function downloadFixture(app: ElectronApplication, root: string) {
  await expect
    .poll(() =>
      app.evaluate(({ app }) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const require = createRequire(`${app.getAppPath()}/package.json`);
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
        return autoUpdater.autoInstallOnAppQuit;
      }),
    )
    .toBe(false);
  const current = await app.evaluate(({ app }) => app.getVersion());
  const parts = current.split('.');
  const version = `${parts[0]}.${parts[1]}.${Number(parts[2]!.split('-')[0]) + 1}`;
  const bytes = Buffer.alloc(22);
  bytes.writeUInt32LE(0x06054b50);
  const digest = createHash('sha512').update(bytes).digest('base64');
  let corrupt = true;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url?.split('?')[0] === '/synthetic-arm64.zip') {
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': bytes.length,
      });
      response.end(corrupt ? Buffer.alloc(bytes.length, 1) : bytes);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/yaml' });
      response.end(
        JSON.stringify({
          version,
          files: [{ url: 'synthetic-arm64.zip', sha512: digest, size: bytes.length }],
          releaseDate: '2026-01-01T00:00:00.000Z',
        }),
      );
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing download fixture port.');
  try {
    await app.evaluate(
      ({ app }, { url, root }) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const { homedir } = process.getBuiltinModule('node:os');
        if (homedir() !== root)
          throw new Error('Updater test cache must use the isolated test home.');
        const require = createRequire(`${app.getAppPath()}/package.json`);
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
        if (!app.isPackaged) {
          // Source-mode tests use the repository's real development update configuration.
          autoUpdater.updateConfigPath = `${process.cwd()}/dev-app-update.yml`;
        } else {
          const { readFileSync } = process.getBuiltinModule('node:fs');
          const config = readFileSync(`${process.resourcesPath}/app-update.yml`, 'utf8');
          for (const line of ['provider: github', 'owner: opheleon', 'repo: aiden-preview']) {
            if (!config.split(/\r?\n/).includes(line))
              throw new Error('Unexpected packaged update feed.');
          }
        }
        autoUpdater.setFeedURL({ provider: 'generic', url });
        const state = { unhandled: 0, downloadedFile: '', checksumFailures: 0 };
        Object.assign(globalThis, { aidenDownloadTest: state });
        process.on('unhandledRejection', () => state.unhandled++);
        autoUpdater.on('error', (error) => {
          if (error.message.includes('sha512 checksum mismatch')) state.checksumFailures++;
        });
        autoUpdater.on('update-downloaded', (event) => {
          state.downloadedFile = event.downloadedFile;
        });
        if (autoUpdater.autoInstallOnAppQuit)
          throw new Error('Fixture must never install on quit.');
      },
      { url: `http://127.0.0.1:${address.port}/`, root },
    );
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    requests,
    setCorrupt: (value: boolean) => {
      corrupt = value;
    },
    verify: async (expectedChecksumFailures = 0) => {
      const result = await app.evaluate(() => {
        const { readFileSync } = process.getBuiltinModule('node:fs');
        const { createHash } = process.getBuiltinModule('node:crypto');
        const state = (
          globalThis as typeof globalThis & {
            aidenDownloadTest: {
              unhandled: number;
              downloadedFile: string;
              checksumFailures: number;
            };
          }
        ).aidenDownloadTest;
        return {
          unhandled: state.unhandled,
          checksumFailures: state.checksumFailures,
          digest: createHash('sha512').update(readFileSync(state.downloadedFile)).digest('base64'),
        };
      });
      expect(result.unhandled).toBe(0);
      expect(result.checksumFailures).toBe(expectedChecksumFailures);
      expect(result.digest).toBe(digest);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
