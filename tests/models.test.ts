import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claudeModels } from '../packages/runtimes/src/claude.js';
import { Runtimes } from '../packages/runtimes/src/index.js';
import { required } from './required.js';

void test('Claude discovery uses selected authentication, no prompts or tools, and closes the runtime', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-models-'));
  let options: any;
  let prompt: any;
  let closed = 0;
  let account: any = {
    apiProvider: 'firstParty',
    subscriptionType: 'max',
    tokenSource: 'oauth',
    apiKeySource: 'none',
  };
  const deps: any = {
    binary: () => '/fake/claude',
    status: () => Promise.resolve('authenticated'),
    query: (input: any) => {
      options = input.options;
      prompt = input.prompt;
      return {
        accountInfo: () => Promise.resolve(account),
        supportedModels: () => Promise.resolve([{ value: 'model-id', displayName: 'Model label' }]),
        close: () => closed++,
      };
    },
  };
  process.env.ANTHROPIC_API_KEY = 'sk-inherited-test';
  try {
    assert.deepEqual(
      await claudeModels(
        home,
        { provider: 'claude', auth: 'subscription' },
        'sk-explicit-test',
        deps,
      ),
      [{ id: 'model-id', label: 'Model label' }],
    );
    assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
    assert.deepEqual(options.tools, []);
    assert.deepEqual(options.settingSources, []);
    assert.deepEqual(options.mcpServers, {});
    assert.equal((await prompt.next()).done, true);
    assert.equal(closed, 1);
    account = { apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' };
    await assert.rejects(
      claudeModels(home, { provider: 'claude', auth: 'subscription' }, undefined, deps),
      /selected authentication/,
    );
    await claudeModels(home, { provider: 'claude', auth: 'apiKey' }, 'sk-explicit-test', deps);
    assert.equal(options.env.ANTHROPIC_API_KEY, 'sk-explicit-test');
    assert.equal(options.env.CLAUDE_CONFIG_DIR, path.join(home, 'claude-api'));
    await assert.rejects(
      claudeModels(home, { provider: 'claude', auth: 'subscription' }, undefined, {
        ...deps,
        status: () => Promise.resolve('sign_in_required'),
      }),
      /Sign in/,
    );
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

void test('Codex discovery paginates the chosen profile and never falls back from subscription to API', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aiden-models-codex-'));
  const binary = path.join(home, 'codex');
  await writeFile(
    binary,
    `#!/usr/bin/env node
const readline=require('node:readline');
let api=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);if(m.id===undefined)return;
let result={};
if(m.method==='account/login/start')api=true;
if(m.method==='account/read')result={account:{type:api?'apiKey':'chatgpt'}};
if(m.method==='model/list')result=m.params.cursor?{data:[{model:'second',displayName:'Second'}],nextCursor:null}:{data:[{model:'first',displayName:'First',isDefault:true}],nextCursor:'page2'};
process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});\n`,
    { mode: 0o755 },
  );
  const prior = process.env.AIDEN_CODEX_BINARY;
  process.env.AIDEN_CODEX_BINARY = binary;
  const runtime = new Runtimes(home);
  try {
    assert.deepEqual(
      (await runtime.models({ provider: 'codex', auth: 'subscription' })).map((m) => m.id),
      ['first', 'second'],
    );
    runtime.setKey('codex', 'synthetic-key');
    assert.equal(
      required((await runtime.models({ provider: 'codex', auth: 'apiKey' }))[0]).isDefault,
      true,
    );
    await writeFile(
      binary,
      (await readFile(binary, 'utf8')).replace("api?'apiKey':'chatgpt'", "'apiKey'"),
    );
    await assert.rejects(
      runtime.models({ provider: 'codex', auth: 'subscription' }),
      /selected authentication/,
    );
  } finally {
    runtime.dispose();
    if (prior === undefined) delete process.env.AIDEN_CODEX_BINARY;
    else process.env.AIDEN_CODEX_BINARY = prior;
  }
});
