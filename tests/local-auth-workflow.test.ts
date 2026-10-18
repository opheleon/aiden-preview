import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { RunEvent } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { Store } from '../packages/core/src/storage.js';
import { saveVerificationSettings } from '../packages/core/src/verification-settings.js';
import { readVerification } from '../packages/core/src/verification-workflow.js';
import type { AgentRuntime } from '../packages/runtimes/src/index.js';
import { demoAccount, startAuthDemo } from '../scripts/local-auth-demo/server.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';

void test('synthetic model turns drive a complete engine run against the real local authenticated app and API', async (t) => {
  const f = await fixture();
  const demo = await startAuthDemo(path.join(f.root, 'demo'));
  const base = new FixtureRuntime(f);
  const prompts: string[] = [];
  const observations: string[] = [];
  const runtime: AgentRuntime = {
    run: async (r) => {
      prompts.push(r.prompt);
      assert.ok(!r.prompt.includes(demoAccount.password));
      assert.ok(!r.prompt.includes(demoAccount.apiKey));
      if (r.prompt.includes('how a careful person would check'))
        return {
          version: 'fixture-only',
          value: {
            items: [
              {
                requirementId: 'REQ-1',
                edgeCaseId: null,
                method: 'app',
                persona: null,
                reason: 'Check the saved note.',
              },
              {
                requirementId: 'REQ-2',
                edgeCaseId: null,
                method: 'api',
                persona: null,
                reason: 'Check API-key access.',
              },
            ],
          },
        };
      if (
        r.prompt.includes("Aiden's independent screenshot reviewer") ||
        r.prompt.includes('You independently review recorded API evidence')
      )
        return {
          version: 'fixture-only',
          value: {
            judgment: 'satisfied',
            observation: 'Synthetic reviewer approves the recorded assertions.',
          },
        };
      const api = r.prompt.includes("Aiden's API verification agent");
      if (!api && !r.prompt.includes("Aiden's acceptance tester")) return base.run(r);
      assert.match(r.prompt, api ? /"credentialsAvailable":false/ : /"credentialsAvailable":true/);
      const client = new Client({ name: 'local-auth-fixture-only', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(r.tools.url), {
          requestInit: { headers: { Authorization: `Bearer ${r.tools.token}` } },
        }) as Transport,
      );
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({
          name,
          arguments: { reason: 'Synthetic test step against real local app', ...args },
        });
        assert.ok(!result.isError, JSON.stringify(result.content));
        for (const item of result.content as { type: string; text?: string }[])
          if (item.text) observations.push(item.text);
      };
      let proofCheck = 1;
      try {
        const available = (await client.listTools()).tools.map((tool) => tool.name);
        if (api) {
          assert.match(r.prompt, /"authentication":"api-key"/);
          assert.ok(!available.includes('api_identity'));
          assert.ok(!available.includes('api_tamper_token'));
          for (const [index, bearer] of [null, 'invalid-test-token', '@secret:apiKey'].entries()) {
            await call('api_request', { method: 'GET', path: 'notes', body: null, bearer });
            await call('api_check', {
              requestId: index + 1,
              assertions: [{ field: 'status', operator: 'equals', value: index === 2 ? 200 : 401 }],
            });
          }
          proofCheck = 3;
        } else {
          assert.ok(!available.includes('browser_type_credential'));
          assert.ok(available.includes('browser_sign_in'));
          assert.match(r.prompt, /"authentication":"private-web-login"/);
          await call('browser_type', {
            role: 'textbox',
            name: 'New note',
            text: 'Saved by the full Aiden engine test',
          });
          await call('browser_click', { role: 'button', name: 'Save note' });
          await call('page_check', {
            role: 'text',
            name: 'Saved by the full Aiden engine test',
            state: 'visible',
          });
        }
        return {
          version: 'fixture-only',
          value: {
            outcome: 'pass',
            unverifiedReason: null,
            explanation: 'Synthetic agent observed the required real behavior.',
            expected: null,
            observed: null,
            proofCheck,
          },
        };
      } finally {
        await client.close();
      }
    },
  };
  const store = new Store(path.join(f.root, 'data'));
  const events: RunEvent[] = [];
  const engine = new Engine(store, runtime, (event) => events.push(event));
  t.after(async () => {
    await engine.dispose();
    await demo.close();
  });
  const prepared = await engine.prepare(f.project);
  await engine.wait(prepared.runId);
  await engine.approve(f.project.id, prepared.runId, {
    ...f.product,
    requirements: [
      { id: 'REQ-1', text: 'Users can save a note after signing in.' },
      {
        id: 'REQ-2',
        text: 'The notes API accepts a valid API key and rejects missing or invalid keys.',
      },
    ],
  });
  await saveVerificationSettings(engine, f.project.id, {
    url: `${demo.origin}/app`,
    webLogin: { loginUrl: `${demo.origin}/login` },
    webCredentials: { username: demoAccount.email, password: demoAccount.password },
    api: { url: `${demo.origin}/api/`, keyHeader: 'X-API-Key', allowMutations: false },
    apiKey: demoAccount.apiKey,
  });
  const run = await engine.verify(f.project.id);
  await engine.wait(run.runId);
  const saved = await readVerification(engine, f.project.id, run.runId);
  assert.ok(saved, JSON.stringify(events.at(-1)));
  assert.deepEqual(
    saved.result.criteria.map((c) => c.verdict),
    ['pass', 'pass'],
  );
  assert.equal(saved.result.runtime.version, 'fixture-only');
  assert.equal(
    demo.db.notes(demo.db.apiUser(demoAccount.apiKey)!)[0]?.text,
    'Saved by the full Aiden engine test',
  );
  const evidence =
    JSON.stringify({ prompts, observations, events, result: saved.result }) +
    (await readFile(saved.reportPath, 'utf8'));
  assert.ok(!evidence.includes(demoAccount.password));
  assert.ok(!evidence.includes(demoAccount.apiKey));
});
