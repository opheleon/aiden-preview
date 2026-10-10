import assert from 'node:assert/strict';
import { mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { validateFindings } from '../packages/contracts/src/index.js';
import { ToolBroker } from '../packages/tools/src/broker.js';
import { noTools, serveTools } from '../packages/tools/src/mcp.js';
import { fixture } from './helpers.js';
import { required } from './required.js';
void test('evidence requires exact inspected snapshots, coverage and contiguous lines', async () => {
  const f = await fixture();
  const s = required(f.snapshots[0]);
  const evidence = {
    repositoryId: s.repositoryId,
    sha: s.sha,
    path: 'app.txt',
    startLine: 1,
    endLine: 2,
    explanation: 'Actual implementation',
  };
  const findings = {
    assessments: [
      {
        requirementId: 'REQ-1',
        status: 'partial',
        deviation: true,
        explanation: 'FE and BE paths disagree',
        evidence: [evidence],
        remainingWork: ['Align paths'],
        unknowns: [],
      },
      {
        requirementId: 'REQ-2',
        status: 'missing',
        deviation: false,
        explanation: 'No create endpoint in either small fixture',
        evidence: [],
        remainingWork: ['Add creation'],
        unknowns: [],
      },
    ],
    risks: [],
    dependencies: ['FE/BE alignment'],
    unknowns: [],
  };
  assert.throws(() => validateFindings(findings, f.product, f.snapshots, []), /actually read/);
  const receipts = [
    { ...evidence, endLine: 1 },
    { ...evidence, startLine: 2 },
  ];
  assert.equal(
    required(validateFindings(findings, f.product, f.snapshots, receipts).assessments[0]).deviation,
    true,
  );
  assert.throws(
    () =>
      validateFindings(
        { ...findings, assessments: [required(findings.assessments[0])] },
        f.product,
        f.snapshots,
        receipts,
      ),
    /exactly/,
  );
  assert.throws(
    () =>
      validateFindings(
        {
          ...findings,
          assessments: [
            {
              ...required(findings.assessments[0]),
              evidence: [{ ...evidence, path: '../secret' }],
            },
            required(findings.assessments[1]),
          ],
        },
        f.product,
        f.snapshots,
        receipts,
      ),
    /safe/,
  );
  assert.throws(
    () =>
      validateFindings(
        {
          ...findings,
          assessments: [
            { ...required(findings.assessments[0]), status: 'unknown', evidence: [] },
            required(findings.assessments[1]),
          ],
        },
        f.product,
        f.snapshots,
        receipts,
      ),
    /evidence|limitation/,
  );
});
void test('broker forbids arbitrary commands, unfrozen snapshots, traversal, symlinks, and analysis-time sync', async () => {
  const f = await fixture();
  const artifacts = path.join(f.root, 'artifacts');
  await mkdir(artifacts);
  const b = new ToolBroker(f.project, artifacts, path.join(f.root, 'reads.json'), () =>
    Promise.resolve('answer'),
  );
  b.snapshots = f.snapshots;
  await assert.rejects(b.call('shell', { command: 'cat ~/.ssh/id_rsa' }), /not allowed/);
  await assert.rejects(b.call('artifact_write', { path: '../secret', text: 'bad' }), /Unsafe/);
  await symlink(f.root, path.join(artifacts, 'escape'));
  await assert.rejects(b.call('artifact_write', { path: 'escape/secret', text: 'bad' }), /Symlink/);
  await assert.rejects(
    b.call('repo_read', { repositoryId: 'frontend', sha: '0'.repeat(40), path: 'app.txt' }),
    /frozen/,
  );
  await assert.rejects(b.call('repo_sync', { repositoryId: 'frontend' }), /Synchronization/);
  const result: any = await b.call('repo_read', {
    repositoryId: 'frontend',
    sha: required(f.snapshots[0]).sha,
    path: 'app.txt',
    startLine: 1,
    endLine: 2,
  });
  assert.match(result.text, /GET \/books/);
  assert.equal(b.reads.length, 1);
  await b.call('artifact_write', { path: 'notes/observations.md', text: 'Evidence only' });
  assert.equal(
    await readFile(path.join(artifacts, 'notes/observations.md'), 'utf8'),
    'Evidence only',
  );
});
void test('MCP uses authenticated local HTTP and the same broker', async () => {
  const f = await fixture();
  const artifacts = path.join(f.root, 'artifacts');
  await mkdir(artifacts);
  const b = new ToolBroker(f.project, artifacts, path.join(f.root, 'reads.json'), () =>
    Promise.resolve('answer'),
  );
  b.snapshots = f.snapshots;
  const server = await serveTools(b);
  const client = new Client({ name: 'test', version: '1' });
  try {
    assert.equal((await fetch(server.url, { method: 'POST', body: '{}' })).status, 401);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${server.token}` } },
      }) as Transport,
    );
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === 'repo_read'));
    assert.equal(server.toolCount, tools.tools.length);
    const empty = await serveTools(noTools);
    assert.equal(empty.toolCount, 0);
    await empty.close();
    const result: any = await client.callTool({
      name: 'repo_read',
      arguments: { repositoryId: 'frontend', sha: required(f.snapshots[0]).sha, path: 'app.txt' },
    });
    assert.equal(result.isError, undefined);
    assert.match(required(result.content[0]).text, /GET \/books/);
  } finally {
    await client.close();
    await server.close();
  }
});
