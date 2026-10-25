import { execFileSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Build the installed-app desktop helpers into dist/native. The macOS helper builds only on macOS;
// the Windows helper is a script and is copied everywhere so Windows packages always include it.
const out = path.resolve('dist/native');
await mkdir(path.join(out, 'windows'), { recursive: true });
await copyFile('native/windows/desktop.ps1', path.join(out, 'windows', 'desktop.ps1'));

if (process.platform === 'darwin') {
  const macos = path.join(out, 'macos');
  await mkdir(macos, { recursive: true });
  const helper = path.join(macos, 'aiden-desktop');
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-O',
      '-swift-version',
      '5',
      '-target',
      'arm64-apple-macos14.0',
      'native/macos/desktop/main.swift',
      'native/macos/desktop/target.swift',
      'native/macos/desktop/driver.swift',
      '-o',
      helper,
    ],
    { stdio: 'inherit' },
  );
  // Development builds are ad-hoc signed; packaging re-signs the helper with the app's Developer ID.
  execFileSync('codesign', ['--sign', '-', '--force', '--options', 'runtime', helper], {
    stdio: 'inherit',
  });
}
