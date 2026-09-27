import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { atomic } from '../packages/core/src/storage.js';
import {
  assessTool,
  ConnectionManager,
  toolFingerprint,
} from '../packages/integrations/src/index.js';
import { ToolBroker } from '../packages/tools/src/broker.js';
import { serveTools } from '../packages/tools/src/mcp.js';
import { fixture } from './helpers.js';

void test('external tool policy blocks writes and unknown operations until explicit read approval', () => {
  const read = assessTool(
    { name: 'list_issues', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
    ['list_issues'],
  );
  const disguisedWrite = assessTool(
    { name: 'update_issue', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
    ['update_issue'],
  );
  const unknown = assessTool({ name: 'execute', inputSchema: { type: 'object' } }, ['execute']);
  assert.equal(read.readOnly, true);
  assert.equal(read.approved, true);
  assert.equal(disguisedWrite.readOnly, false);
  assert.equal(disguisedWrite.approved, false);
  assert.equal(unknown.readOnly, false);
});

void test('tool definition changes produce a different approval fingerprint', () => {
  const first = [
    assessTool({ name: 'list_issues', description: 'List', inputSchema: { type: 'object' } }),
  ];
  const changed = [
    assessTool({
      name: 'list_issues',
      description: 'List everything',
      inputSchema: { type: 'object' },
    }),
  ];
  assert.notEqual(toolFingerprint(first), toolFingerprint(changed));
});

void test('hosted MCP connection metadata excludes credentials and approved reads produce receipts', async () => {
  const f = await fixture();
  const artifactRoot = path.join(f.root, 'artifacts');
  await mkdir(artifactRoot);
  const broker = new ToolBroker(f.project, artifactRoot, path.join(f.root, 'reads.json'), () =>
    Promise.resolve('fixture'),
  );
  broker.snapshots = f.snapshots;
  const hosted = await serveTools(broker);
  const manager = new ConnectionManager(path.join(f.root, 'aiden-data'), { keyring: false });
  try {
    const connection = await manager.add({
      name: 'Fixture hosted MCP',
      provider: 'custom',
      url: hosted.url,
      auth: 'bearer',
      bearer: hosted.token,
      sessionOnly: true,
    });
    const connected = await manager.connect(connection.id);
    assert.equal(connected.connection.status, 'connected');
    const tools = await manager.refreshTools(connection.id);
    assert.ok(tools.some((tool) => tool.name === 'repo_inventory' && tool.readOnly));
    const current = await manager.get(connection.id);
    await manager.approve(connection.id, ['repo_inventory'], current.toolFingerprint!);
    const read = await manager.call(connection.id, 'repo_inventory', {});
    assert.equal(read.receipt.connectionId, connection.id);
    assert.equal(read.receipt.tool, 'repo_inventory');
    assert.match(read.receipt.resultHash, /^[a-f0-9]{64}$/);
    // Simulate a reviewed contract that differs from the server's current definition.
    const saved = await manager.get(connection.id);
    saved.toolFingerprint = 'previous-reviewed-contract';
    await atomic(path.join(f.root, 'aiden-data', 'integrations', 'connections.json'), [saved]);
    await assert.rejects(manager.call(connection.id, 'repo_inventory', {}), /no longer/);
    assert.deepEqual((await manager.get(connection.id)).approvedTools, []);

    await assert.rejects(
      manager.call(connection.id, 'artifact_write', { path: 'x', text: 'x' }),
      /not approved/,
    );

    const bearer = await manager.add({
      name: 'Secret fixture',
      provider: 'custom',
      url: hosted.url,
      auth: 'bearer',
      bearer: 'fixture-secret-that-must-not-leak',
      sessionOnly: true,
    });
    assert.equal(bearer.secureStorage, 'session');
    const metadata = await readFile(
      path.join(f.root, 'aiden-data', 'integrations', 'connections.json'),
      'utf8',
    );
    assert.doesNotMatch(metadata, /fixture-secret-that-must-not-leak/);
    assert.doesNotMatch(metadata, new RegExp(hosted.token));
  } finally {
    await manager.dispose();
    await hosted.close();
  }
});
