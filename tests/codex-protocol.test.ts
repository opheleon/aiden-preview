import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanEnvironment, RpcClient, Runtimes } from '../packages/runtimes/src/index.js';
import type { RuntimeRequest } from '../packages/runtimes/src/types.js';

// A local protocol substitute, never a provider connection or live model result.
async function codexFixture(mode = 'success') {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-codex-protocol-'));
  const binary = path.join(root, 'codex');
  const calls = path.join(root, 'calls.jsonl');
  await writeFile(
    binary,
    `#!/usr/bin/env node
if (process.env.AIDEN_TEST_SECRET) process.exit(9);
const fs = require('node:fs');
const mode = ${JSON.stringify(mode)};
const calls = ${JSON.stringify(calls)};
if (process.argv.includes('--version')) { console.log('synthetic-codex-1'); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let api = false;
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  fs.appendFileSync(calls, JSON.stringify(m) + '\\n');
  if (m.method === 'hang') return;
  if (m.method === 'malformed') { process.stdout.write('{broken\\n'); return; }
  if (m.method === 'oversized') { process.stdout.write('x'.repeat(2000001) + '\\n'); return; }
  if (m.method === 'exit') { process.exit(1); }
  if (m.method === 'late') { setTimeout(() => send({ id:m.id, result:'late' }), 50); return; }
  if (m.method === 'denied') { send({ id:'provider-request', method:'shell/run', params:{} }); return; }
  if (m.id === 'provider-request') { send({ id:1, result:m.error }); return; }
  if (m.method === 'error') { send({id:m.id,error:{message:'bad sk-test-secret Bearer hidden'}});return; }
  let result = {};
  if (m.method === 'account/login/start') { api=m.params.type==='apiKey'; result={authUrl:'https://example.invalid/login'}; }
  if (m.method === 'account/read') result={account:{type:mode==='wrong-auth'?'other':api?'apiKey':'chatgpt'}};
  if (m.method === 'model/list') result=mode==='bad-models'?{data:'invalid'}:
    {data:[{model:'synthetic-model',displayName:'Synthetic model',isDefault:mode!=='no-default'}],nextCursor:mode==='repeated-models'?'repeat':null};
  if (m.method === 'config/read') result={config:{mcp_servers:{inherited:{command:'never-run'}}}};
  if (m.method === 'thread/start') result={thread:{id:'synthetic-thread'}};
  if (m.method === 'mcpServerStatus/list') result={data:mode==='missing-tools'?[]:
    mode==='foreign-tools'?[{name:'foreign',tools:{shell:{}}}]:[{name:'aiden',tools:{repo_read:{}}}],
    nextCursor:mode==='repeated-tools'?'repeat':null};
  send({id:m.id,result});
  if (m.method === 'turn/start' && mode !== 'hang-turn') {
    send({method:'item/completed',params:{threadId:'unrelated',item:{type:'agentMessage',text:'ignore'}}});
    send({method:'item/completed',params:{threadId:'synthetic-thread',item:{type:'agentMessage',text:mode==='invalid-json'?'not JSON':'{"fixture":true}'}}});
    send({method:'turn/completed',params:mode==='bad-event'?{}:{threadId:'synthetic-thread',turn:{status:mode==='failed-turn'?'failed':'completed',error:{message:'bad sk-test-secret'}}}});
  }
});
`,
    { mode: 0o755 },
  );
  const previous = process.env.AIDEN_CODEX_BINARY;
  const previousSecret = process.env.AIDEN_TEST_SECRET;
  process.env.AIDEN_CODEX_BINARY = binary;
  process.env.AIDEN_TEST_SECRET = 'must-not-reach-provider-or-version-probe';
  const runtime = new Runtimes(root);
  const request: RuntimeRequest = {
    config: { provider: 'codex', auth: 'subscription' },
    cwd: root,
    tools: { url: 'http://127.0.0.1:1/mcp', token: 'synthetic-only' },
    prompt: 'Synthetic fixture only.',
    schema: { type: 'object' },
    signal: AbortSignal.timeout(5000),
    progress: () => {},
  };
  return {
    root,
    runtime,
    request,
    calls,
    close: async () => {
      runtime.dispose();
      if (previous === undefined) delete process.env.AIDEN_CODEX_BINARY;
      else process.env.AIDEN_CODEX_BINARY = previous;
      if (previousSecret === undefined) delete process.env.AIDEN_TEST_SECRET;
      else process.env.AIDEN_TEST_SECRET = previousSecret;
      await rm(root, { recursive: true, force: true });
    },
  };
}

void test('Codex isolates tools and executes exactly one turn in the explicitly selected billing mode', async () => {
  for (const auth of ['subscription', 'apiKey'] as const) {
    const fixture = await codexFixture();
    try {
      fixture.runtime.setKey('codex', 'synthetic-key');
      const result = await fixture.runtime.run({
        ...fixture.request,
        config: { provider: 'codex', auth },
      });
      assert.deepEqual(result, {
        value: { fixture: true },
        model: 'synthetic-model',
        version: 'synthetic-codex-1',
      });
      const calls = (await readFile(fixture.calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1);
      const thread = calls.find((call) => call.method === 'thread/start').params;
      assert.equal(thread.approvalPolicy, 'never');
      assert.equal(thread.ephemeral, true);
      assert.deepEqual(thread.config.mcp_servers.inherited, { enabled: false });
      assert.equal(thread.config.features.shell_tool, false);
      assert.equal(thread.config.features.plugins, false);
      assert.equal(thread.config.project_doc_max_bytes, 0);
      assert.equal(
        calls.some((call) => call.method === 'account/login/start'),
        auth === 'apiKey',
      );
    } finally {
      await fixture.close();
    }
  }
});

void test('Codex rejects mismatched auth, invalid schemas, and unavailable or unexpected tools before submitting a prompt', async () => {
  for (const [mode, expected] of [
    ['wrong-auth', /selected authentication/],
    ['bad-models', /Expected array/],
    ['no-default', /default model/],
    ['missing-tools', /unavailable/],
    ['foreign-tools', /Unexpected MCP/],
    ['repeated-tools', /repeated/],
  ] as const) {
    const fixture = await codexFixture(mode);
    try {
      await assert.rejects(fixture.runtime.run(fixture.request), expected);
      assert.doesNotMatch(await readFile(fixture.calls, 'utf8'), /turn\/start/);
    } finally {
      await fixture.close();
    }
  }
});

void test('Codex rejects failed turns and malformed output without retrying paid work', async () => {
  for (const mode of ['invalid-json', 'failed-turn', 'bad-event']) {
    const fixture = await codexFixture(mode);
    try {
      await assert.rejects(fixture.runtime.run(fixture.request), (error: Error) => {
        assert.doesNotMatch(error.message, /sk-test-secret/);
        return true;
      });
      assert.equal(
        (await readFile(fixture.calls, 'utf8'))
          .split('\n')
          .filter((line) => line.includes('turn/start')).length,
        1,
      );
    } finally {
      await fixture.close();
    }
  }
});

void test('cancellation closes a Codex turn waiting for its final result', async () => {
  const fixture = await codexFixture('hang-turn');
  try {
    const controller = new AbortController();
    const pending = fixture.runtime.run({ ...fixture.request, signal: controller.signal });
    const rejected = assert.rejects(pending, /interrupted|closed/);
    // Wait for turn submission so this exercises completion, not initialization cancellation.
    for (let attempt = 0; attempt < 100; attempt++) {
      const log = await readFile(fixture.calls, 'utf8').catch(() => '');
      if (log.includes('turn/start')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(await readFile(fixture.calls, 'utf8'), /turn\/start/);
    controller.abort();
    await rejected;
  } finally {
    await fixture.close();
  }
});

void test('RPC deadlines, malformed output, exit, and unsupported server requests settle safely', async () => {
  const fixture = await codexFixture();
  try {
    for (const method of ['malformed', 'oversized', 'exit']) {
      const client = new RpcClient(cleanEnvironment(), fixture.root);
      const exited = once(client.process, 'exit');
      const pending = client.request('hang');
      const rejection = assert.rejects(pending, /invalid response|exited/);
      await assert.rejects(client.request(method), /invalid response|exited/);
      await rejection;
      await exited;
      assert.equal(client.closed, true);
      assert.equal(client.listeners.size, 0);
      await assert.rejects(client.request('initialize'), /closed/);
      client.close();
    }
    const client = new RpcClient(cleanEnvironment(), fixture.root);
    try {
      await assert.rejects(client.request('late', {}, 1), /timed out/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(await client.initialize(), {});
      await assert.rejects(client.request('error'), /bad \[redacted\] Bearer \[redacted\]/);
      await assert.rejects(client.request('hang', {}, 0), /Invalid runtime request timeout/);
    } finally {
      client.close();
    }
    const guarded = new RpcClient(cleanEnvironment(), fixture.root);
    try {
      assert.deepEqual(await guarded.request('denied'), {
        code: -32601,
        message: 'Aiden does not allow this operation.',
      });
    } finally {
      guarded.close();
    }
  } finally {
    await fixture.close();
  }
});

void test('model discovery rejects repeated pages and malformed model data', async () => {
  for (const mode of ['repeated-models', 'bad-models']) {
    const fixture = await codexFixture(mode);
    try {
      await assert.rejects(
        fixture.runtime.models(fixture.request.config),
        /repeated|Expected array/,
      );
    } finally {
      await fixture.close();
    }
  }
});
