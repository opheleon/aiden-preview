import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  DesktopTargetSchema,
  DesktopTestSchema,
} from '../packages/contracts/src/desktop-verification.js';
import {
  type DesktopHost,
  DesktopVerification,
} from '../packages/core/src/desktop-verification.js';
import type { AgentRuntime, RuntimeRequest } from '../packages/runtimes/src/index.js';
import { DesktopAppSession } from '../packages/verification/src/desktop-app.js';
import { DesktopSession } from '../packages/verification/src/desktop-session.js';
import { png } from './device-fixture.js';

const frame = [0.1, 0.1, 0.2, 0.05];
const elements = [
  { id: 1, role: 'Button', name: 'Add note', enabled: true, frame },
  { id: 2, role: 'TextField', name: 'Password', enabled: true, secure: true, frame },
  { id: 3, role: 'Button', name: 'Delete account', enabled: true, frame },
];

/** A scripted helper process speaking the line protocol; a click simulates an app update. */
function fakeHelper(signer = 'ABCDE12345'): DesktopAppSession {
  const script = `
    const lines = require('readline').createInterface({ input: process.stdin });
    let version = '2.0 (7)';
    lines.on('line', (line) => {
      const request = JSON.parse(line);
      let data;
      if (request.op === 'open' || request.op === 'identity')
        data = { path: '/Applications/Notes.app', name: 'Notes', identifier: 'com.example.notes', version, signer: ${JSON.stringify(signer)}, signature: 'trusted' };
      else if (request.op === 'observe')
        data = { app: 'Notes', window: 'Notes', foreground: false, elements: ${JSON.stringify(elements)}, screenshot: ${JSON.stringify(png)} };
      else if (request.op === 'click') version = '2.1 (8)';
      process.stdout.write(JSON.stringify({ id: request.id, ok: true, ...(data ? { data } : {}) }) + '\\n');
    });`;
  return new DesktopAppSession(
    spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'ignore'] }),
  );
}

/** Drive the real MCP tools with synthetic conclusions, never a live model or app. */
class DesktopFixtureRuntime implements AgentRuntime {
  async run(r: RuntimeRequest) {
    const review = r.prompt.includes('independent reviewer');
    const client = new Client({ name: 'desktop-fixture', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(r.tools.url), {
        requestInit: { headers: { Authorization: `Bearer ${r.tools.token}` } },
      }) as Transport,
    );
    try {
      if (review) await client.callTool({ name: 'view_desktop_evidence', arguments: { id: 2 } });
      else {
        await client.callTool({ name: 'desktop_observe', arguments: { reason: 'Inspect app' } });
        const click = await client.callTool({
          name: 'desktop_click',
          arguments: { element: 1, observationId: 1, reason: 'Add a note' },
        });
        assert.equal(click.isError, undefined);
      }
      return {
        version: 'desktop-fixture-only',
        value: { verdict: 'pass', explanation: 'Synthetic screenshot evidence.', evidence: [2] },
      };
    } finally {
      await client.close();
    }
  }
}

/** Host helpers that report ready and open the scripted helper. */
function host(signer?: string): DesktopHost {
  return {
    readiness: () => Promise.resolve({ ready: true, checks: [] }),
    requestAccess: () => Promise.resolve(),
    apps: () => Promise.resolve([]),
    open: () => fakeHelper(signer),
  };
}

const config = DesktopTestSchema.parse({
  name: 'Notes beta',
  target: { appPath: '/Applications/Notes.app' },
  criteria: ['A note can be added'],
  runtime: { provider: 'codex', auth: 'subscription' },
  allowInteractions: true,
});

void test('desktop tools bind element ids to the latest observation and refuse secrets and destructive labels', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-session-'));
  const app = fakeHelper();
  t.after(async () => {
    app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const session = new DesktopSession(app, dir, 10, AbortSignal.timeout(30000));
  await assert.rejects(
    session.call('desktop_click', { element: 1, observationId: 1, reason: 'Too early' }),
    /Observe again/,
  );
  await session.call('desktop_observe', { reason: 'Look' });
  await assert.rejects(
    session.call('desktop_type', { element: 2, observationId: 1, text: 'x', reason: 'Sign in' }),
    /Password fields/,
  );
  await assert.rejects(
    session.call('desktop_click', { element: 3, observationId: 1, reason: 'Cleanup' }),
    /manual verification/,
  );
  await session.call('desktop_click', { element: 1, observationId: 1, reason: 'Add a note' });
  await assert.rejects(
    session.call('desktop_click', { element: 1, observationId: 1, reason: 'Stale id' }),
    /Observe again/,
  );
  assert.equal(session.observations.length, 2);
  assert.match(session.observations[1]!.result, /window only/);
  assert.ok(existsSync(path.join(dir, 'step-2.png')) && existsSync(path.join(dir, 'step-2.json')));
});

void test('desktop runs drive the installed app, review evidence, and report a version change', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-desktop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new DesktopVerification(root, new DesktopFixtureRuntime(), host());
  const { runId } = await service.start(config);
  await assert.rejects(service.start(config), /already being tested/);
  await service.wait(runId);
  const run = await service.read(runId);
  assert.equal(run?.status, 'completed', run?.message);
  assert.equal(run.criteria[0]?.verdict, 'pass');
  assert.equal(run.app?.version, '2.0 (7)');
  assert.equal(run.versionAfter, '2.1 (8)');
  const report = await readFile(run.reportPath, 'utf8');
  assert.match(report, /updated during this test, to version 2\.1 \(8\)/);
  assert.match(report, /synthetic test fixture, not a live agent/);
});

void test("desktop runs follow the team's allowed app publishers and fail closed", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-desktop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** Run once under a team policy and return the saved run. */
  const runWith = async (signer: string, policy: () => Promise<string[] | null>) => {
    const service = new DesktopVerification(root, new DesktopFixtureRuntime(), host(signer));
    service.teamPublishers = policy;
    const { runId } = await service.start(config);
    await service.wait(runId);
    return (await service.read(runId))!;
  };
  const allowed = await runWith('ABCDE12345', () => Promise.resolve(['abcde12345', 'Contoso']));
  assert.equal(allowed.status, 'completed', allowed.message);
  const refused = await runWith('ZZZZZ99999', () => Promise.resolve(['ABCDE12345']));
  assert.equal(refused.status, 'failed');
  assert.match(
    refused.message,
    /allows testing apps from ABCDE12345 only\. Notes is signed by ZZZZZ99999/,
  );
  assert.equal(refused.criteria.length, 0);
  const unreadable = await runWith('ABCDE12345', () => Promise.reject(new Error('offline')));
  assert.match(unreadable.message, /Could not read your team's allowed app publishers/);
  assert.equal(unreadable.criteria.length, 0);
});

void test('desktop targets must be a full path to an installed app', () => {
  for (const appPath of ['/Applications/Notes.app', 'C:\\Program Files\\Notes\\Notes.exe'])
    assert.equal(DesktopTargetSchema.safeParse({ appPath }).success, true);
  for (const appPath of ['Notes.app', '/Users/me/Downloads/Notes.dmg', '/bin/sh'])
    assert.equal(DesktopTargetSchema.safeParse({ appPath }).success, false);
});
