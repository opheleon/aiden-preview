import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { cleanEnvironment } from '../packages/runtimes/src/environment.js';
import { RpcClient } from '../packages/runtimes/src/rpc.js';
import { providerLauncher } from '../tests/desktop/provider-launcher.js';
import { fixture } from '../tests/helpers.js';

// Fail early on launcher and pipe problems, before spending time packaging the app.
const provider = await providerLauncher(await fixture());
const { stdout } = await promisify(execFile)(provider.binary, ['--version'], {
  env: cleanEnvironment(),
  timeout: 10_000,
});
assert.match(stdout, /synthetic-desktop-provider/);
process.env.AIDEN_CODEX_BINARY = provider.binary;
const client = new RpcClient(cleanEnvironment(), process.cwd());
try {
  await client.request('initialize', {}, 10_000);
  const account = await client.request('account/read', {}, 10_000);
  assert.ok(account);
  console.log('Synthetic provider executable and JSON-RPC pipes passed.');
} finally {
  client.close();
}
