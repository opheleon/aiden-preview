import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { fixture } from '../helpers.js';

export async function providerLauncher(f: Awaited<ReturnType<typeof fixture>>) {
  const fixtureFile = path.join(f.root, 'fixture.json');
  const control = path.join(f.root, 'control.json');
  const calls = path.join(f.root, 'calls.txt');
  await writeFile(fixtureFile, JSON.stringify(f));
  await writeFile(control, JSON.stringify({ clarification: true }));
  await writeFile(calls, '');
  const binary = path.join(f.root, 'provider-fixture');
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const args = [
    process.execPath,
    '--import',
    import.meta.resolve('tsx'),
    fileURLToPath(new URL('./provider-fixture.ts', import.meta.url)),
    fixtureFile,
    control,
    calls,
  ];
  await writeFile(binary, '#!/bin/sh\nexec ' + args.map(quote).join(' ') + ' "$@"\n', {
    mode: 0o755,
  });
  const claude = path.join(f.root, 'claude-fixture');
  await writeFile(
    claude,
    '#!/bin/sh\nprintf \'%s\\n\' \'{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}\'\n',
    { mode: 0o755 },
  );
  return { binary, claude, control, calls };
}
