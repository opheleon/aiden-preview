import { type ElectronApplication, expect } from '@playwright/test';

export async function verifyPackagedRuntimes(app: ElectronApplication) {
  const result = await app.evaluate(({ app }) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const require = createRequire(`${app.getAppPath()}/package.json`);
    // Load the native binding without reading or writing anyone's keychain entries.
    const keyring = require('@napi-rs/keyring') as { Entry?: unknown };
    const { bundledClaudeBinary } = require(
      `${app.getAppPath()}/dist/packages/runtimes/src/claude-auth.js`,
    ) as {
      bundledClaudeBinary: () => string;
    };
    const binary = bundledClaudeBinary();
    const { spawnSync } = process.getBuiltinModule('node:child_process');
    // Version-only execution sends no model prompts and inherits no provider credentials.
    const probe = spawnSync(binary, ['--version'], {
      timeout: 10_000,
      encoding: 'utf8',
      env: { HOME: app.getPath('userData'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    });
    return {
      keyringLoaded: typeof keyring.Entry === 'function',
      unpacked: binary.includes('.asar.unpacked/'),
      status: probe.status,
      error: probe.error?.message,
      version: probe.stdout?.trim(),
    };
  });
  expect(result.keyringLoaded).toBe(true);
  expect(result.unpacked).toBe(true);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.version).toMatch(/Claude Code/);
}
