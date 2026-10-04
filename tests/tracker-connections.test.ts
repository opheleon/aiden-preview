import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readOnlyLinear,
  trackerConnection,
  trackerLabel,
  trackerUrl,
} from '../packages/contracts/src/tracker-connections.js';
import { atomic } from '../packages/core/src/storage.js';
import { ConnectionManager } from '../packages/integrations/src/index.js';

void test('repeated and concurrent preset setup reuses one identity while preserving older reader credentials', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-preset-'));
  const manager = new ConnectionManager(root, { keyring: false });
  try {
    const legacy = await manager.add({
      name: 'Linear',
      provider: 'linear',
      url: 'https://mcp.linear.app/mcp/readonly',
      auth: 'oauth',
    });
    const rows = await Promise.all([
      manager.preset('linear'),
      manager.preset('linear'),
      manager.preset('linear'),
    ]);
    assert.equal(new Set(rows.map((c) => c.id)).size, 1);
    assert.notEqual(rows[0].id, legacy.id);
    assert.equal((await manager.list()).length, 2);
    assert.equal((await manager.preset('linear')).id, rows[0].id);
    assert.equal(readOnlyLinear(legacy), true);
    assert.equal(trackerLabel(legacy), 'Linear · Read-only');
    const reopened = new ConnectionManager(root, { keyring: false });
    assert.equal((await reopened.preset('linear')).id, rows[0].id);
    assert.equal((await reopened.preset('jira')).url, trackerUrl('jira'));
    assert.equal((await reopened.list()).length, 3);
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

void test('preset reuse prefers a connected match and preserves custom accounts and legacy endpoints', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-preset-'));
  const manager = new ConnectionManager(root, { keyring: false });
  try {
    const first = await manager.preset('linear');
    const second = await manager.add({
      name: 'Linear work',
      provider: 'linear',
      url: trackerUrl('linear'),
      auth: 'oauth',
    });
    const custom = await manager.add({
      name: 'Custom',
      provider: 'custom',
      url: 'https://example.com/mcp',
      auth: 'none',
    });
    const connected = { ...first, status: 'connected' as const };
    await atomic(path.join(root, 'integrations', 'connections.json'), [connected, second, custom]);
    assert.equal((await manager.preset('linear')).id, first.id);
    assert.equal(
      trackerConnection([first, { ...second, updatedAt: '2099-01-01T00:00:00.000Z' }], 'linear')
        ?.id,
      second.id,
    );
    assert.equal(trackerConnection([custom], 'linear'), undefined);
    assert.equal(trackerLabel(connected), 'Linear · Connected');
    assert.equal(trackerLabel({ ...first, status: 'needs_review' }), 'Linear · Connected');
    assert.equal(
      trackerLabel({ ...first, status: 'authorization_required' }),
      'Linear · Finish sign-in',
    );
    assert.equal(trackerLabel(first), 'Linear · Reconnect required');
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
