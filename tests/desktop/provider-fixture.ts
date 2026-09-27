import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { FixtureRuntime } from '../fixture-runtime.js';
import type { fixture } from '../helpers.js';

// A synthetic local provider protocol peer. It uses the real authenticated MCP evidence tools;
// it never loads provider credentials, contacts a provider, or labels output as a live result.
const [fixturePath, controlPath, callsPath] = process.argv.slice(2);
if (!fixturePath || !controlPath || !callsPath) throw new Error('Missing fixture paths');
if (process.argv.includes('--version')) {
  process.stdout.write('synthetic-desktop-provider-1\n');
  process.exit(0);
}
const f = JSON.parse(readFileSync(fixturePath, 'utf8')) as Awaited<ReturnType<typeof fixture>>;
const controller = new AbortController();
let server: { url: string; http_headers: { Authorization: string } };
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
async function turn(params: any) {
  const control = JSON.parse(readFileSync(controlPath!, 'utf8'));
  const runtime = new FixtureRuntime(f);
  runtime.clarification = !!control.clarification;
  runtime.pause = !!control.pause;
  const pending = runtime.run({
    config: { provider: 'codex', auth: 'subscription' },
    cwd: f.root,
    tools: { url: server.url, token: server.http_headers.Authorization.replace(/^Bearer /, '') },
    prompt: params.input[0].text,
    schema: params.outputSchema,
    signal: controller.signal,
    progress: () => {},
  });
  // Record only stage names, never prompts or the authenticated tool endpoint.
  appendFileSync(callsPath!, runtime.calls[0] + '\n');
  try {
    const result = await pending;
    send({
      method: 'item/completed',
      params: {
        threadId: 'synthetic-thread',
        item: { type: 'agentMessage', text: JSON.stringify(result.value) },
      },
    });
    send({
      method: 'turn/completed',
      params: { threadId: 'synthetic-thread', turn: { status: 'completed' } },
    });
  } catch (error) {
    send({
      method: 'turn/completed',
      params: {
        threadId: 'synthetic-thread',
        turn: {
          status: 'failed',
          error: { message: error instanceof Error ? error.message : 'Fixture failed' },
        },
      },
    });
  }
}
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result: unknown = {};
  switch (message.method) {
    case 'account/read':
      result = { account: { type: 'chatgpt' } };
      break;
    case 'config/read':
      result = { config: { mcp_servers: {} } };
      break;
    case 'model/list':
      result = {
        data: [{ model: 'synthetic-model', displayName: 'Synthetic model', isDefault: true }],
        nextCursor: null,
      };
      break;
    case 'thread/start':
      server = message.params.config.mcp_servers.aiden;
      result = { thread: { id: 'synthetic-thread' } };
      break;
    case 'mcpServerStatus/list':
      result = { data: [{ name: 'aiden', tools: { repo_read: {} } }], nextCursor: null };
      break;
  }
  send({ id: message.id, result });
  if (message.method === 'turn/start') void turn(message.params).catch(() => process.exit(1));
});
input.on('close', () => {
  controller.abort();
  process.exit(0);
});
process.on('SIGTERM', () => {
  controller.abort();
  process.exit(0);
});
