import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { Engine } from '../packages/core/src/engine.js';
import { configureGuideVerification } from '../packages/core/src/guide-verification.js';
import { Store } from '../packages/core/src/storage.js';
import { readVerification } from '../packages/core/src/verification-workflow.js';
import type { AgentRuntime } from '../packages/runtimes/src/index.js';
import { demoAccount, startAuthDemo } from '../scripts/local-auth-demo/server.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';
import { required } from './required.js';

void test('verification advertises private credentials and reauthenticates through real MCP without exposing them', async (t) => {
  const f = await fixture();
  const demo = await startAuthDemo(path.join(f.root, 'demo'));
  const base = new FixtureRuntime(f);
  const messages: string[] = [];
  const runtime: AgentRuntime = {
    async run(request) {
      const agent = request.prompt.includes("Aiden's acceptance tester");
      const vision = request.prompt.includes("Aiden's independent screenshot reviewer");
      if (!agent && !vision) return base.run(request);
      messages.push(request.prompt);
      const input = JSON.parse(
        required(/<input_data>\n(.*)\n<\/input_data>/s.exec(request.prompt)?.[1]),
      );
      const client = new Client({ name: 'synthetic-private-login', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(request.tools.url), {
          requestInit: { headers: { Authorization: `Bearer ${request.tools.token}` } },
        }) as Transport,
      );
      try {
        if (vision) {
          assert.ok(
            input.steps.some((step: { result: string }) =>
              step.result.includes('verified authenticated access'),
            ),
          );
          return {
            value: {
              judgment: 'satisfied',
              observation:
                'Synthetic reviewer confirms the recorded sign-out, private sign-in, and notes page.',
            },
            version: 'fixture-only',
          };
        }
        assert.equal(input.credentialsAvailable, true);
        assert.equal(input.authentication, 'private-web-login');
        assert.ok(request.tools.names?.includes('browser_sign_in'));
        assert.ok(!request.tools.names?.includes('browser_type_credential'));
        for (const [name, args] of [
          ['browser_click', { role: 'button', name: 'Sign out' }],
          ['browser_sign_in', {}],
          ['page_check', { role: 'heading', name: 'Your notes', state: 'visible' }],
        ] as const) {
          const result = await client.callTool({
            name,
            arguments: { ...args, reason: 'Synthetic reauthentication regression' },
          });
          assert.ok(!result.isError, JSON.stringify(result));
          for (const item of result.content as { type: string; text?: string }[])
            if (item.type === 'text') messages.push(item.text!);
        }
        return {
          value: {
            outcome: 'pass',
            proofCheck: 1,
            unverifiedReason: null,
            expected: null,
            observed: null,
            explanation:
              'The configured account signed out, signed in privately, and opened its notes.',
          },
          version: 'fixture-only',
        };
      } finally {
        await client.close();
      }
    },
  };
  const store = new Store(path.join(f.root, 'data'));
  const engine = new Engine(store, runtime);
  t.after(async () => {
    await engine.dispose();
    await demo.close();
  });
  const prepared = await engine.prepare(f.project);
  await engine.wait(prepared.runId);
  await engine.approve(f.project.id, prepared.runId, {
    ...f.product,
    requirements: [
      {
        id: 'REQ-1',
        text: 'After signing out, the existing user can sign in again and view their notes.',
      },
    ],
  });
  await configureGuideVerification(
    engine,
    f.project.id,
    {
      url: `${demo.origin}/app`,
      webLogin: { loginUrl: `${demo.origin}/login` },
      webCredentials: { username: demoAccount.email, password: demoAccount.password },
      rememberCredentials: false,
    },
    true,
  );
  const run = await engine.verify(f.project.id);
  await engine.wait(run.runId);
  const saved = await readVerification({ store }, f.project.id);
  assert.equal(saved?.result.summary.verified, 1, JSON.stringify(saved?.result));
  const visible = JSON.stringify({ messages, result: saved?.result });
  assert.ok(!visible.includes(demoAccount.password));
  assert.ok(!visible.includes(demoAccount.apiKey));
  assert.ok(!JSON.stringify(saved?.result).includes('needs_credentials'));
});
