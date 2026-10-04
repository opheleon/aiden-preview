import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { z } from 'zod/v3';

import type { Project, RuntimeConfig } from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import { saveVerificationSettings } from '../packages/core/src/verification-settings.js';
import { readVerification } from '../packages/core/src/verification-workflow.js';
import { Runtimes } from '../packages/runtimes/src/index.js';

const config: RuntimeConfig = {
  provider: z.enum(['claude', 'codex']).parse(process.argv[2] ?? 'claude'),
  auth: 'subscription',
  ...(process.env.AIDEN_SMOKE_MODEL ? { model: process.env.AIDEN_SMOKE_MODEL } : {}),
};
await mkdir('.aiden/evaluations', { recursive: true });
const output = await mkdtemp(path.resolve('.aiden/evaluations/api-eval-'));
await mkdir(path.join(output, 'synthetic-repo'));
const runtime = new Runtimes(path.join(output, 'providers'));
const token = randomUUID();
let broken = false;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/openapi.json') {
    response.end(
      JSON.stringify({
        openapi: '3.1.0',
        paths: {
          '/auth/register': {
            post: {
              description:
                'Register with JSON username and password; returns access_token and token_type.',
            },
          },
          '/events': { get: { description: 'Requires bearer authentication.' } },
        },
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: { password: { tokenUrl: '/auth/register', scopes: {} } },
            },
          },
          schemas: {
            Token: {
              properties: { access_token: { type: 'string' }, token_type: { type: 'string' } },
            },
          },
        },
      }),
    );
    return;
  }
  if (request.url === '/auth/register' && request.method === 'POST') {
    response.end(JSON.stringify({ access_token: token, token_type: 'bearer', expires_in: 3600 }));
    return;
  }
  if (request.url === '/events' && request.method === 'GET') {
    response.statusCode = broken || request.headers.authorization === `Bearer ${token}` ? 200 : 401;
    response.end(
      JSON.stringify(response.statusCode === 200 ? { events: [] } : { detail: 'Unauthorized' }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ detail: 'Not found' }));
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address !== 'string');
const project: Project = {
  id: 'api-evaluation',
  name: 'Synthetic API verification evaluation',
  context: 'Disposable HTTP evaluation, not an existing user project.',
  repositories: [
    {
      id: 'fixture',
      path: path.join(output, 'synthetic-repo'),
      notes: 'Synthetic fixture; no source inspection in this evaluation.',
    },
  ],
  runtime: config,
};
const engine = new Engine(new Store(path.join(output, 'data')), runtime, (event) => {
  if (event.type === 'progress' && event.message) console.log(event.message);
  if (event.type === 'failed') console.log(JSON.stringify(event));
});
const results: { scenario: string; runId: string; passed: boolean }[] = [];
try {
  await atomic(path.join(engine.store.project(project.id), 'project.json'), project);
  await engine.editProduct(project.id, {
    overview: 'HTTP authentication behavior with a manual-only internal storage check.',
    milestones: [],
    requirements: [
      {
        id: 'REQ-1',
        text: 'GET /events rejects missing and invalid bearer tokens with HTTP 401. Discover the registration endpoint and JSON credentials schema from /openapi.json, then obtain a valid token to establish that GET /events succeeds with HTTP 200.',
      },
      {
        id: 'REQ-2',
        text: 'Stored passwords are hashed in the database. The public HTTP API provides no database or hash inspection endpoint.',
      },
    ],
  });
  await saveVerificationSettings(engine, project.id, {
    api: { url: `http://127.0.0.1:${address.port}/`, allowMutations: true },
  });
  for (const scenario of ['working', 'broken'] as const) {
    broken = scenario === 'broken';
    const run = await engine.verify(project.id);
    const timer = setTimeout(() => {
      void engine.cancel(run.runId);
    }, 5 * 60_000);
    try {
      await engine.wait(run.runId);
    } finally {
      clearTimeout(timer);
    }
    const evidence = await readVerification(engine, project.id);
    assert.equal(evidence?.result.runId, run.runId, 'The live verification must finish');
    const check = evidence.result.criteria.find((c) => c.requirementId === 'REQ-1');
    assert.equal(check?.method, 'api');
    assert.equal(check.verdict, broken ? 'fail' : 'pass');
    assert.ok(check.attempts[0]?.steps.length);
    const steps = check.attempts[0].steps;
    assert.ok(
      steps.some((step) => step.action === 'GET /openapi.json'),
      'Exercise OpenAPI metadata redaction with a real model',
    );
    const registration = steps.find((step) => step.action === 'POST /auth/register');
    assert.ok(registration, 'Credential redaction must preserve the documented endpoint');
    assert.ok(
      registration.result.includes('"token_type":"bearer"'),
      'Token type metadata must remain readable',
    );
    assert.ok(
      registration.result.includes('"access_token":"[redacted]"'),
      'Token values stay hidden while field names remain readable',
    );
    assert.equal(
      evidence.result.triage?.find((t) => t.requirementId === 'REQ-2')?.method,
      'person',
    );
    assert.ok(!JSON.stringify(evidence).includes(token));
    assert.ok(!(await readFile(evidence.reportPath, 'utf8')).includes(token));
    results.push({ scenario, runId: run.runId, passed: true });
    await atomic(path.join(output, 'evaluation.json'), {
      liveModel: true,
      syntheticApi: true,
      runtime: evidence.result.runtime,
      results,
    });
    console.log(`${scenario}: passed; ${evidence.reportPath}`);
  }
} finally {
  await engine.dispose();
  server.closeAllConnections();
  server.close();
}
