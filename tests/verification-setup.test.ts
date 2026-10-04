import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);

for (const [file, name] of [
  ['api-verification.test.ts', 'API recording contains actual assertions'],
  ['verification-browser.test.ts', 'browser actions observe, act, check'],
]) {
  void test(`${file} exits with a useful failure when Chromium is missing`, async (t) => {
    const browsers = await mkdtemp(path.join(tmpdir(), 'aiden-missing-browser-'));
    t.after(() => rm(browsers, { recursive: true, force: true }));
    await assert.rejects(
      execute(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          './tests/setup.ts',
          '--test-name-pattern',
          name!,
          `tests/${file}`,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
          timeout: 15_000,
        },
      ),
      (error: unknown) => {
        const failure = error as Error & { code: number; killed: boolean; stdout: string };
        assert.equal(failure.killed, false, 'Setup failure must exit without leaking a server');
        assert.equal(failure.code, 1);
        assert.match(failure.stdout, /pnpm exec playwright install chromium/);
        return true;
      },
    );
  });
}
