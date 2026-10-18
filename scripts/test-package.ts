import { execFileSync } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaults: Record<string, string> = {
  darwin: 'release/mac/mac-arm64/Aiden.app/Contents/MacOS/Aiden',
  win32: 'release/win/installed/Aiden.exe',
  linux: 'release/linux/squashfs-root/aiden',
};
const executable = process.env.AIDEN_PACKAGED_APP ?? defaults[process.platform];
if (!executable) throw new Error(`Unsupported package platform: ${process.platform}`);
const env: NodeJS.ProcessEnv = { ...process.env, AIDEN_PACKAGED_APP: path.resolve(executable) };
await access(path.resolve(executable));
if (process.platform === 'linux') {
  const images = (await readdir('release/linux')).filter((name) => name.endsWith('.AppImage'));
  if (images.length !== 1) throw new Error('Expected exactly one Linux AppImage.');
  env.APPIMAGE = path.resolve('release/linux', images[0]!);
}
// Invoke Node entrypoints directly so Windows never needs a shell to start a .cmd shim.
execFileSync(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve('@playwright/test/cli')),
    'test',
    '--config',
    'playwright.desktop.config.ts',
  ],
  { env, stdio: 'inherit' },
);
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/desktop-smoke.ts'], {
  env,
  stdio: 'inherit',
});
