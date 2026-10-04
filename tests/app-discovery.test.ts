import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunEvent } from '../packages/contracts/src/index.js';
import { answerCall, readCalls } from '../packages/core/src/calls.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import {
  findRunningApp,
  readAppUrl,
  saveAppUrl,
} from '../packages/core/src/verification-settings.js';
import {
  appPorts,
  candidatePorts,
  commonPorts,
  discoverLocalApps,
} from '../packages/verification/src/discover.js';

/** A fetch stand-in that records every request and answers only on the given ports. */
function fakeFetch(open: number[]) {
  const requests: { url: string; method: string | undefined; redirect: string | undefined }[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    requests.push({ url, method: init.method, redirect: init.redirect });
    const port = Number(new URL(url).port);
    return open.includes(port)
      ? Promise.resolve(
          new Response(null, {
            status: port === 8000 ? 401 : 200,
            headers: {
              'content-type': port === 8000 ? 'application/json' : 'text/html; charset=utf-8',
            },
          }),
        )
      : Promise.reject(new Error('connection refused'));
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/** Run a test in a throwaway folder. */
async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-discover-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test('ports named by package.json scripts come first; odd manifests are skipped', () =>
  withRoot(async (root) => {
    const web = path.join(root, 'web');
    const api = path.join(root, 'api');
    const odd = path.join(root, 'odd');
    const linked = path.join(root, 'linked');
    for (const dir of [web, api, odd, linked]) await mkdir(dir);
    await writeFile(
      path.join(web, 'package.json'),
      JSON.stringify({
        scripts: {
          dev: 'vite --port 5190',
          preview: 'vite preview --port=4999',
          low: 'serve -p 80',
        },
      }),
    );
    await writeFile(
      path.join(api, 'package.json'),
      JSON.stringify({ scripts: { start: 'PORT=4100 node server.js', n: 7 } }),
    );
    await writeFile(path.join(odd, 'package.json'), '{not json');
    await symlink(path.join(web, 'package.json'), path.join(linked, 'package.json'));
    const ports = await candidatePorts([web, api, odd, linked, path.join(root, 'missing')]);
    assert.deepEqual(ports.slice(0, 3), [5190, 4999, 4100]);
    assert.ok(!ports.includes(80), 'privileged ports are not hints');
    assert.deepEqual(ports.slice(3), [...commonPorts]);
  }));

void test('AIDEN_APP_PORTS replaces the default ports, and an empty value probes hints only', () =>
  withRoot(async (root) => {
    assert.equal(appPorts(undefined), undefined);
    assert.deepEqual(appPorts('3000, 80,abc,65536,4321'), [3000, 4321]);
    assert.deepEqual(appPorts(''), []);
    assert.deepEqual(await candidatePorts([root], []), []);
    const { fetch, requests } = fakeFetch([4321]);
    assert.deepEqual(await discoverLocalApps([root], { fetch, ports: [4321] }), [
      'http://localhost:4321/',
    ]);
    assert.equal(requests.length, 1);
  }));

void test('only localhost is probed, with HEAD and no redirects; nothing is started', () =>
  withRoot(async (root) => {
    const { fetch, requests } = fakeFetch([5173, 8000]);
    const found = await discoverLocalApps([root], { fetch, timeoutMs: 50 });
    assert.deepEqual(found, ['http://localhost:5173/']);
    assert.ok(requests.length >= commonPorts.length);
    for (const request of requests) {
      assert.equal(new URL(request.url).hostname, 'localhost');
      assert.equal(request.method, 'HEAD');
      assert.equal(request.redirect, 'manual');
    }
  }));

void test('Aiden requires confirmation even for one HTML page and keeps explicitly saved URLs', () =>
  withRoot(async (root) => {
    const store = new Store(root);
    const projectId = 'discover-project';
    const project = { id: projectId, repositories: [{ id: 'repo', path: root, notes: '' }] };
    await atomic(path.join(store.project(projectId), 'project.json'), project);
    const events: RunEvent[] = [];
    const context = { store, emit: (event: RunEvent) => events.push(event) };
    const run = { id: 'run-1', projectId, project } as never;

    assert.equal(await findRunningApp(context, run, fakeFetch([])), null);
    let [call] = await readCalls(store, projectId);
    assert.equal(call?.kind, 'app-url');
    assert.deepEqual(call?.options, []);
    assert.equal(await findRunningApp(context, run, fakeFetch([])), null);
    assert.equal((await readCalls(store, projectId)).length, 1, 'the question is asked once');
    assert.equal(events.filter((e) => e.activity?.kind === 'ask').length, 1);

    assert.equal(await findRunningApp(context, run, fakeFetch([3000])), null);
    assert.equal((await readAppUrl(context, projectId)).url, null);
    await answerCall(store, projectId, call.id, 'http://localhost:3000/');
    await saveAppUrl(context, projectId, 'http://localhost:3000/');
    [call] = await readCalls(store, projectId);
    assert.equal(call?.status, 'answered');
    assert.equal((await readAppUrl(context, projectId)).url, 'http://localhost:3000/');
    assert.ok(!events.some((e) => e.activity?.kind === 'decide'));

    const probe = fakeFetch([3000, 5173]);
    assert.equal(await findRunningApp(context, run, probe), 'http://localhost:3000/');
    assert.equal(probe.requests.length, 0, 'a saved URL is used without probing');

    await saveAppUrl(context, projectId, null);
    assert.equal(await findRunningApp(context, run, fakeFetch([3000, 5173])), null);
    const open = (await readCalls(store, projectId)).find((c) => c.status === 'open');
    assert.deepEqual(open?.options, ['http://localhost:3000/', 'http://localhost:5173/']);
  }));

void test('API errors, JSON success, redirects and unknown content types never become app candidates', () =>
  withRoot(async (root) => {
    for (const response of [
      new Response('{"detail":"Missing Authorization header"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.invalid/login', 'content-type': 'text/html' },
      }),
      new Response(null),
    ]) {
      const fetch = (() => Promise.resolve(response)) as typeof globalThis.fetch;
      assert.deepEqual(await discoverLocalApps([root], { fetch, ports: [8080] }), []);
    }
    const store = new Store(root);
    const project = { id: 'api-only', repositories: [{ id: 'repo', path: root, notes: '' }] };
    await atomic(path.join(store.project(project.id), 'project.json'), project);
    const context = { store, emit: () => {} };
    assert.equal(
      await findRunningApp(
        context,
        { id: 'run', projectId: project.id, project } as never,
        fakeFetch([8000]),
      ),
      null,
    );
    assert.equal((await readAppUrl(context, project.id)).url, null);
    const [call] = await readCalls(store, project.id);
    assert.equal(call?.kind, 'app-url');
    assert.deepEqual(call?.options, []);
    assert.doesNotMatch(call.question, /credentials|sign.in/i);
  }));

void test('a single unrelated HTML page is only a suggestion, never automatically selected', () =>
  withRoot(async (root) => {
    const store = new Store(root);
    const project = { id: 'unconfirmed', repositories: [{ id: 'repo', path: root, notes: '' }] };
    await atomic(path.join(store.project(project.id), 'project.json'), project);
    const context = { store, emit: () => {} };
    assert.equal(
      await findRunningApp(
        context,
        { id: 'run', projectId: project.id, project } as never,
        fakeFetch([3000]),
      ),
      null,
    );
    assert.equal((await readAppUrl(context, project.id)).url, null);
    const [call] = await readCalls(store, project.id);
    assert.deepEqual(call?.options, ['http://localhost:3000/']);
    assert.equal(call?.status, 'open');
  }));
