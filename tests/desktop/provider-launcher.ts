import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { fixture } from '../helpers.js';
import { executableFixture } from './executable-fixture.js';

export async function providerLauncher(f: Awaited<ReturnType<typeof fixture>>) {
  const fixtureFile = path.join(f.root, 'fixture.json');
  const control = path.join(f.root, 'control.json');
  const calls = path.join(f.root, 'calls.txt');
  await writeFile(fixtureFile, JSON.stringify(f));
  await writeFile(control, JSON.stringify({ clarification: true }));
  await writeFile(calls, '');
  const args = [
    process.execPath,
    '--import',
    import.meta.resolve('tsx'),
    fileURLToPath(new URL('./provider-fixture.ts', import.meta.url)),
    fixtureFile,
    control,
    calls,
  ];
  const binary = await executableFixture(path.join(f.root, 'provider-fixture'), args);
  const claude = await executableFixture(path.join(f.root, 'claude-fixture'), [
    process.execPath,
    '-e',
    'console.log(JSON.stringify({loggedIn:false,authMethod:"none",apiProvider:"firstParty"}))',
    '--',
  ]);
  return { binary, claude, control, calls };
}
