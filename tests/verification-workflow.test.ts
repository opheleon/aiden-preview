import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { RunEvent, RunManifest } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { json, Store } from '../packages/core/src/storage.js';
import {
  readAppUrl,
  readVerification,
  resolveVerifyUrl,
  saveAppUrl,
} from '../packages/core/src/verification-workflow.js';
import {
  type AgentRuntime,
  ArtifactFormatError,
  type RuntimeRequest,
} from '../packages/runtimes/src/index.js';
import { settingsFile } from '../packages/verification/src/index.js';
import { FixtureRuntime } from './fixture-runtime.js';
import { fixture } from './helpers.js';
import { required } from './required.js';
import { assertStrictOutputSchema } from './schema-helpers.js';

const username = 'librarian@example.test';
const password = 'fixture-password-9';
const page = `<!doctype html><title>Library</title><h1>Books</h1>
<label>Username <input oninput="echo.textContent='Signed in as '+this.value"></label><p id="echo"></p>
<ul><li>Dune by Frank Herbert</li></ul><button disabled>Create book</button>`;

/** Read a saved verification and fail the test when none exists. */
async function stored(store: Store, projectId: string, runId?: string) {
  const saved = await readVerification({ store }, projectId, runId);
  assert.ok(saved, 'Expected a saved verification.');
  return saved;
}

/** Scripted browser agent: fixture-only turns that drive the real tools over MCP. */
class ScriptedVerifier implements AgentRuntime {
  turns: string[] = [];
  private attempts = new Map<string, number>();
  constructor(private readonly base: FixtureRuntime) {}

  async run(r: RuntimeRequest) {
    const agent = r.prompt.includes("Aiden's acceptance tester");
    const vision = r.prompt.includes("Aiden's independent screenshot reviewer");
    if (!agent && !vision) return this.base.run(r);
    assertStrictOutputSchema(r.schema);
    assert.equal(r.prompt.includes(password), false);
    const input = JSON.parse(required(/<input_data>\n(.*)\n<\/input_data>/s.exec(r.prompt)?.[1]));
    const client = new Client({ name: 'fixture-only', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(r.tools.url), {
        requestInit: { headers: { Authorization: `Bearer ${r.tools.token}` } },
      }) as Transport,
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({
        name,
        arguments: { reason: 'Fixture step', ...args },
      });
      const content = result.content as { type: string; text?: string; mimeType?: string }[];
      assert.ok(content.some((c) => c.type === 'image'));
      return required(content[0]?.text);
    };
    try {
      if (vision) {
        this.turns.push(`vision:${input.criterion}`);
        const shown = await client.callTool({ name: 'view_proof_screenshot', arguments: {} });
        assert.equal((shown.content as { mimeType?: string }[])[1]?.mimeType, 'image/png');
        const satisfied = !String(input.criterion).includes('create');
        return {
          value: {
            judgment: satisfied ? 'satisfied' : 'not_satisfied',
            observation: satisfied
              ? 'The outlined element matches.'
              : 'Create book looks greyed out.',
          },
          version: 'fixture-only',
        };
      }
      const criterion: string = input.criterion;
      const attempt = (this.attempts.get(criterion) ?? 0) + 1;
      this.attempts.set(criterion, attempt);
      this.turns.push(`agent:${criterion}:${attempt}`);
      return { value: await this.script(criterion, attempt, call, input), version: 'fixture-only' };
    } finally {
      await client.close();
    }
  }

  /** One fixed path per criterion, including a malformed first answer for REQ-4. */
  private async script(
    criterion: string,
    attempt: number,
    call: (name: string, args: Record<string, unknown>) => Promise<string>,
    input: { credentialsAvailable: boolean; stepLimit: number },
  ) {
    const result = { unverifiedReason: null, expected: null, observed: null };
    if (criterion.includes('list')) {
      assert.equal(input.credentialsAvailable, true);
      assert.match(
        await call('browser_type_credential', {
          role: 'textbox',
          name: 'Username',
          credential: 'username',
        }),
        /Signed in as \[test credential\]/,
      );
      await call('page_check', { role: 'heading', name: 'Books', state: 'visible' });
      return {
        ...result,
        outcome: 'pass',
        explanation: `Signed in as ${username} and saw the list — done.`,
        proofCheck: 1,
      };
    }
    if (criterion.includes('create')) {
      await call('page_check', { role: 'button', name: 'Create book', state: 'enabled' });
      return {
        outcome: 'fail',
        unverifiedReason: null,
        explanation: 'The Create book button cannot be used.',
        expected: 'Create book is available.',
        observed: 'Create book is disabled.',
        proofCheck: 1,
      };
    }
    if (criterion.includes('email')) {
      await call('browser_observe', {});
      return {
        ...result,
        outcome: 'unverified',
        unverifiedReason: 'not_testable_in_ui',
        explanation: 'Email delivery is not visible in the app.',
        proofCheck: null,
      };
    }
    if (attempt === 1) throw new ArtifactFormatError('Fixture malformed output.');
    await call('page_check', { role: 'text', name: 'Frank Herbert', state: 'visible' });
    return { ...result, outcome: 'pass', explanation: 'Books show their author.', proofCheck: 1 };
  }
}

void test('verification runs every approved requirement through the engine and publishes evidence', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/`;
  const f = await fixture();
  const runtime = new ScriptedVerifier(new FixtureRuntime(f));
  const store = new Store(path.join(f.root, 'data'));
  const events: RunEvent[] = [];
  const e = new Engine(store, runtime, (event) => events.push(event));
  try {
    const p = await e.prepare(f.project);
    await e.wait(p.runId);
    await e.approve(f.project.id, p.runId, {
      ...f.product,
      requirements: [
        { id: 'REQ-1', text: 'Users can list books.' },
        { id: 'REQ-2', text: 'Users can create books.' },
        { id: 'REQ-3', text: 'A welcome email is sent after signup.' },
        { id: 'REQ-4', text: 'Books show their author.' },
      ],
    });
    const projectDir = store.project(f.project.id);
    await writeFile(
      settingsFile(projectDir),
      JSON.stringify({ credentials: { username, password } }),
      { mode: 0o600 },
    );
    await assert.rejects(e.verify(f.project.id), /Save this project's app URL/);
    await assert.rejects(e.verify(f.project.id, 'https://beta.example.com/'), /is not allowed/);
    assert.equal(await readVerification({ store }, f.project.id), null);

    // The saved app URL is used when no URL is passed, and saving keeps the test credentials.
    assert.deepEqual(await saveAppUrl({ store }, f.project.id, url), { url });
    assert.equal((await stat(settingsFile(projectDir))).mode & 0o777, 0o600);
    const run = await e.verify(f.project.id);
    await e.wait(run.runId);
    const done = events.at(-1);
    assert.equal(done?.type, 'completed', JSON.stringify(done));
    assert.equal(
      done?.verification?.line,
      "1 of 4 criteria verified. 1 failed. 2 couldn't be verified.",
    );
    const saved = await stored(store, f.project.id);
    const { result } = saved;
    assert.deepEqual(
      result.criteria.map((c) => [c.requirementId, c.verdict, c.reason, c.attempts.length]),
      [
        ['REQ-1', 'pass', null, 1],
        ['REQ-2', 'fail', null, 2],
        ['REQ-3', 'unverified', 'not_testable_in_ui', 2],
        ['REQ-4', 'unverified', 'inconsistent_results', 2],
      ],
    );
    const pass = required(result.criteria[0]);
    assert.equal(pass.explanation, 'Signed in as [test credential] and saw the list, done.');
    const proof = required(pass.attempts[0]).proof;
    assert.ok(proof);
    assert.equal(proof.screenshot, 'REQ-1/attempt-1/proof-1.png');
    assert.equal(required(pass.attempts[0]).vision?.judgment, 'satisfied');
    assert.equal(required(result.criteria[1]).observed, 'Create book is disabled.');
    assert.match(
      required(result.criteria[3]).explanation,
      /first run could not verify it and the second run passed/,
    );
    assert.equal(result.runtime.version, 'fixture-only');
    assert.equal(result.runtime.provider, 'codex');
    assert.equal(result.runtime.auth, 'subscription');

    const out = path.dirname(saved.reportPath);
    for (const media of [
      'REQ-1/attempt-1/video.webm',
      'REQ-1/attempt-1/step-01.jpg',
      proof.screenshot,
      'REQ-2/attempt-2/video.webm',
    ])
      assert.ok((await stat(path.join(out, media))).size > 0, media);
    const html = await readFile(saved.reportPath, 'utf8');
    assert.equal((await stat(saved.reportPath)).mode & 0o777, 0o600);
    assert.match(html, /Produced by a test fixture, not a live agent\./);
    assert.match(html, /REQ-1\/attempt-1\/video\.webm#t=\d/);
    const everything = [
      html,
      await readFile(path.join(out, 'results.json'), 'utf8'),
      JSON.stringify(events),
    ].join('\n');
    assert.equal(everything.includes(password), false);
    assert.equal(everything.includes(username), false);
    assert.equal(everything.includes('—'), false);
    const manifest = await json<RunManifest>(
      path.join(store.run(f.project.id, run.runId), 'manifest.json'),
    );
    assert.equal(manifest.status, 'completed');
    assert.equal(manifest.verifyUrl, url);

    // A resumed run reuses finished criteria instead of re-testing them.
    const turns = runtime.turns.length;
    await rm(path.join(out, 'results.json'));
    manifest.status = 'failed';
    await writeFile(
      path.join(store.run(f.project.id, run.runId), 'manifest.json'),
      JSON.stringify(manifest),
    );
    await e.resume(f.project.id, run.runId);
    await e.wait(run.runId);
    assert.equal(runtime.turns.length, turns);
    const resumed = (await stored(store, f.project.id, run.runId)).result;
    assert.deepEqual(resumed.summary, result.summary);

    // An unreachable app fails the run with a plain instruction instead of a verdict.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const down = await e.verify(f.project.id, url);
    await e.wait(down.runId);
    assert.equal(events.at(-1)?.type, 'failed');
    assert.match(
      required(events.at(-1)?.message),
      /Could not open http:\/\/127\.0\.0\.1:\d+\. Start the app and try again\./,
    );
    assert.equal((await stored(store, f.project.id)).result.runId, run.runId);
    await chmod(settingsFile(projectDir), 0o644);
    await assert.rejects(e.verify(f.project.id, url), /chmod 600/);
  } finally {
    await e.dispose();
    if (server.listening) {
      server.closeAllConnections();
      server.close();
    }
  }
});

void test('the app URL is saved per project, validated, cleared, and never exposes credentials', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-app-url-'));
  const store = new Store(root);
  const projectDir = store.project('app-url-project');
  await assert.rejects(
    saveAppUrl({ store }, 'app-url-project', 'http://localhost:3000'),
    /Save this project before setting its app URL/,
  );
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'project.json'), '{}');
  assert.deepEqual(await readAppUrl({ store }, 'app-url-project'), { url: null });
  await writeFile(
    settingsFile(projectDir),
    JSON.stringify({
      credentials: { username, password },
      allowedOrigins: ['https://auth.example.test'],
    }),
    { mode: 0o600 },
  );
  await assert.rejects(
    saveAppUrl({ store }, 'app-url-project', 'file:///etc/passwd'),
    /http and https/,
  );
  await assert.rejects(
    saveAppUrl({ store }, 'app-url-project', 'https://me:secret@beta.example.test'),
    /Remove credentials/,
  );
  assert.deepEqual(await saveAppUrl({ store }, 'app-url-project', ' https://beta.example.test '), {
    url: 'https://beta.example.test/',
  });
  const shown = await readAppUrl({ store }, 'app-url-project');
  assert.deepEqual(shown, { url: 'https://beta.example.test/' });
  assert.equal(JSON.stringify(shown).includes(password), false);
  assert.equal(await resolveVerifyUrl(projectDir), 'https://beta.example.test/');
  assert.equal(
    await resolveVerifyUrl(projectDir, 'https://beta.example.test/settings'),
    'https://beta.example.test/settings',
  );
  await assert.rejects(resolveVerifyUrl(projectDir, 'https://other.example.test'), /not allowed/);
  assert.deepEqual(await saveAppUrl({ store }, 'app-url-project', null), { url: null });
  const kept = JSON.parse(await readFile(settingsFile(projectDir), 'utf8')) as Record<
    string,
    unknown
  >;
  assert.deepEqual(kept.credentials, { username, password });
  assert.deepEqual(kept.allowedOrigins, ['https://auth.example.test']);
  assert.equal('url' in kept, false);
  await assert.rejects(resolveVerifyUrl(projectDir), /Save this project's app URL/);
  await writeFile(settingsFile(projectDir), '{ nope');
  await assert.rejects(readAppUrl({ store }, 'app-url-project'), /not valid JSON/);
});
