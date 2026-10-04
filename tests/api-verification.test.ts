import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { Engine } from '../packages/core/src/engine.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import {
  findRunningApp,
  readAppUrl,
  resolveVerifyUrl,
  saveVerificationSettings,
} from '../packages/core/src/verification-settings.js';
import { readVerification } from '../packages/core/src/verification-workflow.js';
import type { RuntimeRequest } from '../packages/runtimes/src/index.js';
import { ApiHttp, ApiSession, launchBrowser } from '../packages/verification/src/index.js';
import { fixture } from './helpers.js';

const token = 'private-api-token-test-only';

/** A disposable endpoint with no access to calendar data or real accounts. */
async function serverFixture() {
  const requests: { url: string; method: string; auth: string | undefined; body: string }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      requests.push({
        url: request.url!,
        method: request.method!,
        auth: request.headers.authorization,
        body,
      });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/private' });
        response.end();
        return;
      }
      if (request.url === '/big') {
        response.end('x'.repeat(70000));
        return;
      }
      if (request.url === '/nested') {
        response.end(
          JSON.stringify({
            refresh_tokens: ['hidden-array-token'],
            secret: { value: 'hidden-nested-secret' },
          }),
        );
        return;
      }
      if (request.url === '/text') {
        response.end('Bearer secret-token-in-text');
        return;
      }
      if (request.url === '/register') {
        response.setHeader('Set-Cookie', 'session=do-not-record');
        response.end(
          JSON.stringify({ access_token: token, echo: token, account: JSON.parse(body) }),
        );
        return;
      }
      response.statusCode = request.headers.authorization === `Bearer ${token}` ? 200 : 401;
      response.end(
        JSON.stringify({ detail: response.statusCode === 200 ? 'Allowed' : 'Unauthorized' }),
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requests,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

void test('HTTP verification confines requests, gates writes, hides credentials and refuses redirects', async () => {
  const server = await serverFixture();
  const signal = new AbortController().signal;
  const request = {
    method: 'GET' as const,
    path: '/events',
    body: null,
    bearer: null,
    reason: 'Check authentication',
  };
  try {
    const readOnly = new ApiHttp(server.url, false, signal);
    assert.equal((await readOnly.request(request)).status, 401);
    await assert.rejects(readOnly.request({ ...request, method: 'POST' }), /writes are disabled/);
    for (const value of [
      'http://example.invalid/',
      '//example.invalid/',
      '/events?access_token=secret',
      '/#fragment',
      '/@secret:s1',
    ])
      await assert.rejects(readOnly.request({ ...request, path: value }), /outside/);
    await assert.rejects(
      new ApiHttp(`${server.url}api/`, false, signal).request(request),
      /outside/,
    );
    assert.throws(() => new ApiHttp(`${server.url}?token=x`, false, signal), /base URL/);
    assert.throws(() => new ApiHttp('file:///tmp/a', false, signal), /http/);
    await assert.rejects(readOnly.request({ ...request, path: '/redirect' }));
    assert.ok(!server.requests.some((r) => r.url === '/private'));
    await assert.rejects(readOnly.request({ ...request, path: '/big' }), /64 KiB/);
    assert.doesNotMatch(
      JSON.stringify(await readOnly.request({ ...request, path: '/text' })),
      /secret-token-in-text/,
    );
    assert.doesNotMatch(
      JSON.stringify(await readOnly.request({ ...request, path: '/nested' })),
      /hidden-array-token|hidden-nested-secret/,
    );
    const http = new ApiHttp(server.url, true, signal, {
      username: 'private-user',
      password: 'private-password',
    });
    const identity = http.identity();
    assert.match(identity.password, /^@secret:/);
    const response = await http.request({
      ...request,
      method: 'POST',
      path: '/register',
      body: JSON.stringify({ username: '@secret:username', password: '@secret:password' }),
    });
    assert.doesNotMatch(
      JSON.stringify(response),
      /private-user|private-password|private-api-token|do-not-record/,
    );
    const authenticated = await http.request({
      ...request,
      bearer: response.secrets.access_token!,
    });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.bearer, response.secrets.access_token);
    assert.equal((await http.request({ ...request, bearer: 'invalid-test-token' })).status, 401);
    await assert.rejects(http.request({ ...request, bearer: token }), /credential handle/);
    await assert.rejects(http.request({ ...request, bearer: '@secret:missing' }), /Unknown/);
    await assert.rejects(http.request({ ...request, method: 'POST', body: 'not-json' }));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      new ApiHttp(server.url, false, controller.signal).request(request),
      /abort/i,
    );
  } finally {
    server.close();
  }
});

void test('API recording contains actual assertions and sanitized evidence, including failures and limits', async () => {
  const server = await serverFixture();
  const browser = await launchBrowser();
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-api-recording-'));
  const progress: string[] = [];
  const session = await ApiSession.open(
    browser,
    new ApiHttp(server.url, true, new AbortController().signal),
    dir,
    'Reject missing authentication',
    6,
    (action) => progress.push(action),
  );
  try {
    const identity = (await session.call('api_identity', {})) as {
      username: string;
      password: string;
    };
    const receipt = (await session.call('api_request', {
      method: 'POST',
      path: '/register',
      body: JSON.stringify(identity),
      bearer: null,
      reason: 'Create a disposable user',
    })) as { id: number };
    await session.call('api_check', {
      requestId: receipt.id,
      assertions: [
        { field: 'status', operator: 'equals', value: 200 },
        { field: 'body.access_token', operator: 'exists', value: null },
        { field: 'body.noSuchField', operator: 'absent', value: null },
      ],
      reason: 'Check issuance',
    });
    await session.call('api_check', {
      requestId: receipt.id,
      assertions: [{ field: 'status', operator: 'equals', value: 401 }],
      reason: 'Demonstrate a failing assertion',
    });
    assert.deepEqual(
      session.checks.map((c) => c.passed),
      [true, false],
    );
    await assert.rejects(
      session.call('api_check', {
        requestId: 999,
        assertions: [{ field: 'status', operator: 'equals', value: 200 }],
        reason: 'Unknown response',
      }),
      /could not complete/,
    );
    await assert.rejects(
      session.call('api_request', {
        method: 'GET',
        path: '//example.invalid',
        body: null,
        bearer: null,
        reason: 'Forbidden target',
      }),
    );
    await assert.rejects(session.call('api_identity', {}), /step limit/);
    await assert.rejects(session.call('shell', {}), /not allowed/);
    assert.equal(session.stepLimitReached, true);
    assert.ok(progress.includes('POST /register'));
    assert.doesNotMatch(JSON.stringify(progress), /private-api-token-test-only/);
    const evidence = JSON.stringify(session.steps);
    assert.doesNotMatch(evidence, /private-api-token-test-only|do-not-record/);
    assert.doesNotMatch(await session.page.content(), /private-api-token-test-only/);
    const video = await session.close();
    assert.ok((await stat(path.join(dir, video))).size > 0);
    assert.ok((await stat(path.join(dir, session.checks[0]!.screenshot))).size > 0);
    assert.equal(await session.close(), video);
  } finally {
    await session.close();
    await browser.close();
    server.close();
  }
});

/** A synthetic model that drives the real MCP HTTP tools; judgments are explicitly fixtures. */
async function fixtureTurn(
  request: RuntimeRequest,
  judgment: 'satisfied' | 'unclear' | 'not_satisfied',
) {
  if (request.prompt.includes('Before checking a project'))
    return {
      version: 'fixture-api',
      value: {
        items: [
          {
            requirementId: 'REQ-1',
            edgeCaseId: null,
            method: 'api',
            persona: null,
            reason: 'HTTP auth check',
          },
        ],
      },
    };
  if (request.prompt.includes('independently review recorded API'))
    return {
      version: 'fixture-api',
      value: { judgment, observation: 'Synthetic review of the actual HTTP assertions.' },
    };
  const client = new Client({ name: 'fixture-api-verifier', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(request.tools.url), {
      requestInit: { headers: { Authorization: `Bearer ${request.tools.token}` } },
    }) as Transport,
  );
  try {
    const result = await client.callTool({
      name: 'api_request',
      arguments: {
        method: 'GET',
        path: '/events',
        body: null,
        bearer: null,
        reason: 'Missing authentication',
      },
    });
    const receipt = JSON.parse((result.content as { text: string }[])[0]!.text);
    await client.callTool({
      name: 'api_check',
      arguments: {
        requestId: receipt.id,
        assertions: [
          { field: 'status', operator: 'equals', value: judgment === 'not_satisfied' ? 200 : 401 },
        ],
        reason: 'Require the expected status',
      },
    });
    return {
      version: 'fixture-api',
      value: {
        outcome: judgment === 'not_satisfied' ? 'fail' : 'pass',
        unverifiedReason: null,
        explanation: 'Missing authentication was rejected.',
        expected: 'HTTP 401',
        observed: 'HTTP 401',
        proofCheck: 1,
      },
    };
  } finally {
    await client.close();
  }
}

void test('production verification publishes API video, requires a coverage review, and supports API-only settings', async () => {
  const server = await serverFixture();
  const f = await fixture();
  const store = new Store(path.join(f.root, 'api-data'));
  let judgment: 'satisfied' | 'unclear' | 'not_satisfied' = 'satisfied';
  const engine = new Engine(store, { run: (request) => fixtureTurn(request, judgment) });
  try {
    await atomic(path.join(store.project(f.project.id), 'project.json'), f.project);
    await engine.editProduct(f.project.id, {
      overview: 'Test API auth',
      milestones: [],
      requirements: [{ id: 'REQ-1', text: 'Missing authentication receives HTTP 401.' }],
    });
    const configured = await saveVerificationSettings(engine, f.project.id, {
      api: { url: server.url },
    });
    assert.equal(configured.api?.allowMutations, false);
    assert.equal(configured.url, null);
    assert.equal(await resolveVerifyUrl(store.project(f.project.id)), server.url);
    assert.equal(
      await findRunningApp(engine, { id: 'run', projectId: f.project.id, project: f.project }),
      server.url,
    );
    for (const expected of ['pass', 'unverified', 'fail'] as const) {
      const run = await engine.verify(f.project.id);
      await engine.wait(run.runId);
      const saved = await readVerification(engine, f.project.id);
      assert.equal(saved?.result.runId, run.runId);
      assert.equal(saved.result.criteria[0]?.method, 'api');
      assert.equal(saved.result.criteria[0]?.verdict, expected);
      assert.equal(saved.result.criteria[0]?.attempts.length, 1);
      assert.ok(
        (
          await stat(
            path.join(path.dirname(saved.reportPath), saved.result.criteria[0].attempts[0]!.video),
          )
        ).size > 0,
      );
      assert.match(await readFile(saved.reportPath, 'utf8'), /API/);
      judgment = expected === 'pass' ? 'unclear' : 'not_satisfied';
    }
    judgment = 'satisfied';
    await assert.rejects(
      saveVerificationSettings(engine, f.project.id, {
        api: { url: `${server.url}?token=secret` },
      }),
      /base URL/,
    );
    await engine.editProduct(f.project.id, {
      overview: 'API plus unavailable UI',
      milestones: [],
      requirements: [
        { id: 'REQ-1', text: 'Missing authentication receives HTTP 401.' },
        { id: 'REQ-2', text: 'The sign-in form is visible.' },
      ],
    });
    // An API-only configuration must not open the API endpoint as an application UI.
    const apiOnly = await engine.verify(f.project.id);
    await engine.wait(apiOnly.runId);
    assert.match(
      (await readVerification(engine, f.project.id))!.result.criteria[1]!.explanation,
      /browser app URL/,
    );
    // A configured but stopped UI must not abort or hide completed API checks.
    await saveVerificationSettings(engine, f.project.id, { url: 'http://127.0.0.1:1/' });
    const stoppedUi = await engine.verify(f.project.id);
    await engine.wait(stoppedUi.runId);
    const mixed = (await readVerification(engine, f.project.id))!.result;
    assert.equal(mixed.runId, stoppedUi.runId);
    assert.equal(mixed.criteria[0]?.verdict, 'pass');
    assert.match(mixed.criteria[1]!.explanation, /browser app could not be opened/);
    await engine.editProduct(f.project.id, {
      overview: 'API',
      milestones: [],
      requirements: [{ id: 'REQ-1', text: 'Missing authentication receives HTTP 401.' }],
    });
    await saveVerificationSettings(engine, f.project.id, { api: null, url: server.url });
    assert.equal((await readAppUrl(engine, f.project.id)).api, undefined);
    const noApi = await engine.verify(f.project.id);
    await engine.wait(noApi.runId);
    const result = await readVerification(engine, f.project.id);
    assert.match(result!.result.criteria[0]!.explanation, /Set an API URL/);
    assert.equal(result!.result.criteria[0]!.attempts.length, 0);
  } finally {
    await engine.dispose();
    server.close();
  }
});

void test('OpenAPI auth metadata remains readable while JWT fixtures and credential echoes stay secret', async () => {
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"disposable","exp":1}').toString('base64url')}.${Buffer.from('test-signature').toString('base64url')}`;
  const auth: string[] = [];
  const server = createServer((request, response) => {
    if (request.headers.authorization) auth.push(request.headers.authorization);
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url === '/openapi.json'
          ? {
              openapi: '3.1.0',
              components: {
                securitySchemes: { oauth: { flows: { password: { tokenUrl: '/auth/login' } } } },
                schemas: {
                  Token: {
                    properties: { access_token: { type: 'string', description: 'A bearer token' } },
                  },
                },
              },
            }
          : { access_token: jwt, token_type: 'bearer', echo: jwt },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const http = new ApiHttp(
    `http://127.0.0.1:${address.port}/`,
    false,
    new AbortController().signal,
    undefined,
    jwt,
  );
  const request = {
    method: 'GET' as const,
    path: '/openapi.json',
    body: null,
    bearer: null,
    reason: 'Read schema',
  };
  try {
    const schema = await http.request(request);
    assert.match(JSON.stringify(schema.body), /\/auth\/login/);
    assert.match(JSON.stringify(schema.body), /A bearer token/);
    assert.deepEqual(schema.secrets, {});
    const issued = await http.request({ ...request, path: '/token' });
    assert.equal((issued.body as { token_type: string }).token_type, 'bearer');
    assert.doesNotMatch(JSON.stringify(issued), new RegExp(jwt.replaceAll('.', '\\.')));
    assert.equal(
      http.redact('POST /auth/login returns a bearer token'),
      'POST /auth/login returns a bearer token',
    );
    const variants = http.tamper(issued.secrets.access_token!);
    assert.throws(() => http.tamper(jwt), /handle/);
    assert.throws(() => http.tamper('@secret:missing'), /Unknown/);
    for (const bearer of [variants.tamperedSignature, variants.unsigned, '@secret:expiredToken'])
      await http.request({ ...request, path: '/events', bearer });
    assert.notEqual(auth[0], `Bearer ${jwt}`);
    assert.equal(auth[0]!.split('.')[1], jwt.split('.')[1], 'Tampering preserves claims');
    assert.ok(auth[1]!.endsWith('.'), 'Unsigned fixture has no signature');
    assert.equal(auth[2], `Bearer ${jwt}`, 'Expired fixture is passed through, never forged');
    assert.ok(!JSON.stringify(http.receipts).includes(jwt));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

void test('a completed criterion publishes playable evidence while a later API criterion is still running', async () => {
  const server = await serverFixture();
  const f = await fixture();
  const store = new Store(path.join(f.root, 'incremental-data'));
  let inspected = false;
  const engine: Engine = new Engine(store, {
    run: async (request) => {
      if (request.prompt.includes('Before checking a project')) {
        const result = await fixtureTurn(request, 'satisfied');
        const value = result.value as { items: { requirementId: string }[] };
        value.items.push({ ...value.items[0]!, requirementId: 'REQ-2' });
        return result;
      }
      if (request.prompt.includes('"criterion":"Second criterion')) {
        const state = await engine.state(f.project.id);
        const run = state.runs.find((r) => r.kind === 'verify')!;
        assert.equal(run.status, 'running');
        const partial = await readVerification(engine, f.project.id, run.id);
        assert.equal(partial?.result.partial, true);
        assert.equal(partial.result.criteria.length, 1);
        assert.match(await readFile(partial.reportPath, 'utf8'), /still in progress/);
        const video = partial.result.criteria[0]!.attempts[0]!.video;
        assert.ok((await stat(path.join(path.dirname(partial.reportPath), video))).size > 0);
        inspected = true;
      }
      return fixtureTurn(request, 'satisfied');
    },
  });
  try {
    await atomic(path.join(store.project(f.project.id), 'project.json'), f.project);
    await engine.editProduct(f.project.id, {
      overview: 'Incremental evidence',
      milestones: [],
      requirements: [
        { id: 'REQ-1', text: 'Missing authentication receives HTTP 401.' },
        { id: 'REQ-2', text: 'Second criterion rejects missing authentication.' },
      ],
    });
    await saveVerificationSettings(engine, f.project.id, { api: { url: server.url } });
    const run = await engine.verify(f.project.id);
    await engine.wait(run.runId);
    assert.equal(inspected, true);
    const result = await readVerification(engine, f.project.id);
    assert.equal(result?.result.criteria.length, 2);
    assert.notEqual(result.result.partial, true);
  } finally {
    await engine.dispose();
    server.close();
  }
});
