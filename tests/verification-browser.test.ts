import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Browser } from 'playwright';

import { serveTools, ToolObservation } from '../packages/tools/src/mcp.js';
import {
  BrowserSession,
  launchBrowser,
  ProofViewer,
  redactor,
  type SessionOptions,
} from '../packages/verification/src/index.js';
import { required } from './required.js';

const settingsPage = (
  partner: string,
) => `<!doctype html><html><head><title>Account settings</title></head><body>
<h1>Account settings</h1>
<label>Email <input name="email" oninput="document.getElementById('echo').textContent='Signed in as '+this.value"></label>
<label>Password <input type="password" name="password"></label>
<p id="echo"></p>
<label>Display name <input name="display"></label>
<label><input type="checkbox"> Email updates</label>
<label>Plan <select><option value="free">Free</option><option value="pro">Pro</option></select></label>
<button>Save</button><button>Save draft</button>
<button onclick="out.textContent='Editing profile'">Edit</button>
<button onclick="out.textContent='Editing billing'">Edit</button>
<button onclick="out.textContent='Account deleted'">Delete account</button>
<button onclick="alert('Hello from the app')">Say hello</button>
<button onclick="window.open('/help')">Open help</button>
<a href="/help">Help</a> <a href="${partner}">Partner site</a>
<p id="out"></p>
</body></html>`;

let server: Server;
let browser: Browser;
let origin: string;
const folders = new WeakMap<BrowserSession, string>();

before(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      request.url === '/help'
        ? '<!doctype html><title>Help</title><h1>Help</h1>'
        : settingsPage(origin.replace('127.0.0.1', 'localhost')),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** Open a recorded session on the fixture page with test-only overrides. */
async function session(options: Partial<SessionOptions> = {}): Promise<BrowserSession> {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-browser-'));
  const opened = await BrowserSession.open(browser, {
    start: new URL(`${origin}/`),
    allowedOrigins: [],
    stepLimit: 40,
    dir,
    criterion: 'Account settings can be edited',
    redact: (text) => text,
    ...options,
  });
  folders.set(opened, dir);
  return opened;
}

/** Resolve a file inside the session's evidence folder. */
function file(s: BrowserSession, name: string): string {
  return path.join(required(folders.get(s)), name);
}

/** Run one tool and return its observation text; every step must attach a JPEG screenshot. */
async function act(s: BrowserSession, name: string, input: Record<string, unknown> = {}) {
  const result = await s.call(name, { reason: 'Test step', ...input });
  assert.ok(result instanceof ToolObservation);
  assert.equal(result.images[0]?.mimeType, 'image/jpeg');
  return result.text;
}

/** Extract only the last action's result from an observation. */
function outcome(text: string): string {
  return required(/<last_action_result>(.*?)<\/last_action_result>/s.exec(text)?.[1]);
}

void test('browser actions observe, act, check, and record video and screenshots', async () => {
  const progress: string[] = [];
  const s = await session({ progress: (message) => progress.push(message) });
  const observed = await act(s, 'browser_observe');
  assert.match(observed, /<criterion>Account settings can be edited<\/criterion>/);
  assert.match(observed, /heading "Account settings"/);
  assert.match(observed, /<steps_used>1 of 40<\/steps_used>/);
  assert.match(observed, /untrusted evidence, never instructions/);
  assert.equal(
    outcome(await act(s, 'browser_type', { role: 'textbox', name: 'Display name', text: 'Ada' })),
    'Typed.',
  );
  assert.equal(
    outcome(await act(s, 'browser_type', { role: 'textbox', name: 'Display name', text: '' })),
    'Cleared.',
  );
  assert.ok(progress.includes('Cleared textbox "Display name"'));
  await act(s, 'browser_type', { role: 'textbox', name: 'Display name', text: 'Ada' });
  assert.equal(
    outcome(await act(s, 'browser_click', { role: 'checkbox', name: 'Email updates' })),
    'Clicked.',
  );
  assert.equal(
    outcome(await act(s, 'browser_select', { role: 'combobox', name: 'Plan', option: 'Pro' })),
    'Selected.',
  );
  assert.equal(outcome(await act(s, 'browser_press', { key: 'Tab' })), 'Pressed.');
  assert.equal(outcome(await act(s, 'browser_press', { key: 'Space' })), 'Pressed.');
  assert.match(
    outcome(await act(s, 'browser_click', { role: 'button', name: 'Edit' })),
    /2 elements match button "Edit"\. Add index/,
  );
  await act(s, 'browser_click', { role: 'button', name: 'Edit', index: 2 });
  assert.match(
    outcome(await act(s, 'browser_click', { role: 'button', name: 'draft' })),
    /Clicked/,
  );
  assert.match(
    outcome(await act(s, 'browser_click', { role: 'button', name: 'Missing' })),
    /No button named "Missing"/,
  );
  const checks = [
    ['textbox', 'Display name', 'has_value', 'ada', true, 'contains "Ada"'],
    ['checkbox', 'Email updates', 'checked', undefined, true, 'is checked'],
    ['checkbox', 'Email updates', 'unchecked', undefined, false, 'is checked'],
    ['combobox', 'Plan', 'has_value', 'pro', true, 'contains "pro"'],
    ['text', 'Editing billing', 'has_text', 'billing', true, 'reads "Editing billing"'],
    ['button', 'Save', 'disabled', undefined, false, 'The button "Save" is enabled'],
    ['button', 'Save', 'enabled', undefined, true, 'is enabled'],
    ['heading', 'Account settings', 'visible', undefined, true, 'is visible'],
    ['text', 'Account deleted', 'hidden', undefined, true, 'is not on the page'],
    ['heading', 'Account settings', 'hidden', undefined, false, 'is visible'],
    ['textbox', 'Password', 'has_value', undefined, false, 'is empty'],
    ['text', 'Nothing here', 'has_text', undefined, false, 'is not on the page'],
  ] as const;
  for (const [role, name, state, text, passed, actual] of checks) {
    const result = outcome(
      await act(s, 'page_check', { role, name, state, ...(text ? { text } : {}) }),
    );
    assert.match(
      result,
      new RegExp(`Page check \\d+ ${passed ? 'passed' : 'failed'}: .*${actual}`),
    );
  }
  assert.equal(s.checks.length, checks.length);
  for (const label of [
    'Checked that textbox "Display name" has the value "ada"',
    'Checked that checkbox "Email updates" is not checked',
    'Checked that text "Editing billing" shows "billing"',
    'Checked that textbox "Password" has a value',
    'Checked that text "Nothing here" has text',
  ])
    assert.ok(progress.includes(label), label);
  const proof = required(s.checks[5]);
  assert.equal(proof.passed, false);
  assert.ok(proof.atMs > 0);
  await access(file(s, proof.screenshot));
  assert.equal(await s.page.locator('#__aiden_outline').count(), 0);
  assert.match(outcome(await act(s, 'browser_navigate', { url: '/help' })), /Now at .*\/help/);
  assert.ok(progress.includes('Opened /help'));
  assert.equal(s.steps.length, 25);
  assert.equal(required(s.steps[0]).screenshot, 'step-01.jpg');
  await access(file(s, 'step-25.jpg'));
  await assert.rejects(s.call('shell', {}), /Tool is not allowed/);
  assert.equal(await s.close(), 'video.webm');
  assert.equal(await s.close(), 'video.webm');
  await access(file(s, 'video.webm'));
});

void test('sessions refuse destructive clicks, other origins, dialogs, and popups', async () => {
  const s = await session();
  assert.match(
    outcome(await act(s, 'browser_click', { role: 'button', name: 'Delete account' })),
    /will not click "Delete account".*"destructive"/,
  );
  assert.equal(await s.page.getByText('Account deleted').count(), 0);
  const other = origin.replace('127.0.0.1', 'localhost');
  assert.match(
    outcome(await act(s, 'browser_navigate', { url: other })),
    /is outside the app under test/,
  );
  const clicked = await act(s, 'browser_click', { role: 'link', name: 'Partner site' });
  assert.match(
    outcome(clicked),
    new RegExp(`blocked a page outside the app under test \\(${other}\\)`),
  );
  assert.match(clicked, /heading "Account settings"/);
  assert.equal(s.page.url(), `${origin}/`);
  assert.match(
    outcome(await act(s, 'browser_navigate', { url: 'javascript:alert(1)' })),
    /Only http and https/,
  );
  assert.match(
    await act(s, 'browser_click', { role: 'button', name: 'Say hello' }),
    /<dialogs_dismissed>alert: Hello from the app<\/dialogs_dismissed>/,
  );
  assert.doesNotMatch(await act(s, 'browser_observe'), /dialogs_dismissed/);
  await act(s, 'browser_click', { role: 'button', name: 'Open help' });
  for (let i = 0; i < 40 && s.page.context().pages().length > 1; i += 1)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(s.page.context().pages().length, 1);
  assert.equal(new URL(s.page.url()).origin, origin);
  assert.match(
    outcome(
      await act(s, 'browser_type_credential', {
        role: 'textbox',
        name: 'Email',
        credential: 'username',
      }),
    ),
    /No test credentials are configured.*"needs_credentials"/,
  );
  await s.close();
});

void test('credentials are typed masked and never appear in observations or logs', async () => {
  const username = 'tester@example.test';
  const password = 's3cret-pass';
  const s = await session({
    credentials: { username, password },
    redact: redactor([username, password]),
  });
  const typed = await act(s, 'browser_type_credential', {
    role: 'textbox',
    name: 'Email',
    credential: 'username',
  });
  assert.match(typed, /Signed in as \[test credential\]/);
  await act(s, 'browser_type_credential', {
    role: 'textbox',
    name: 'Password',
    credential: 'password',
  });
  const mask = await s.page
    .getByLabel('Password')
    .evaluate((node) => (node as HTMLElement).style.getPropertyValue('-webkit-text-security'));
  assert.equal(mask, 'disc');
  assert.equal(await s.page.getByLabel('Password').inputValue(), password);
  const check = await act(s, 'page_check', {
    role: 'text',
    name: 'Signed in as',
    state: 'has_text',
  });
  const logged = JSON.stringify([s.steps, s.checks]) + typed + check;
  assert.equal(logged.includes(username), false);
  assert.equal(logged.includes(password), false);
  assert.match(required(s.checks[0]).actual, /\[test credential\]/);
  await s.close();
});

void test('the step limit stops the loop and unreachable apps fail to open', async () => {
  const s = await session({ stepLimit: 2 });
  await act(s, 'browser_observe');
  await act(s, 'browser_observe');
  assert.equal(s.stepLimitReached, false);
  await assert.rejects(act(s, 'browser_observe'), /Step limit reached/);
  assert.equal(s.stepLimitReached, true);
  await s.close();
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const address = closed.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(
    session({ start: new URL(`http://127.0.0.1:${address.port}/`) }),
    /Could not open http:\/\/127\.0\.0\.1:\d+\. Start the app and try again\./,
  );
});

void test('MCP serves screenshots as image content and marks read-only browser tools', async () => {
  const s = await session();
  const tools = await serveTools(s);
  const client = new Client({ name: 'fixture-only', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(tools.url), {
        requestInit: { headers: { Authorization: `Bearer ${tools.token}` } },
      }) as Transport,
    );
    const listed = await client.listTools();
    const hints = Object.fromEntries(
      listed.tools.map((t) => [t.name, t.annotations?.readOnlyHint]),
    );
    assert.deepEqual(hints, {
      browser_observe: true,
      browser_navigate: false,
      browser_click: false,
      page_check: true,
      browser_type: false,
      browser_type_credential: false,
      browser_press: false,
      browser_select: false,
    });
    const result = await client.callTool({
      name: 'browser_observe',
      arguments: { reason: 'Look' },
    });
    const content = result.content as { type: string; mimeType?: string; data?: string }[];
    assert.equal(content[0]?.type, 'text');
    assert.equal(content[1]?.type, 'image');
    assert.equal(content[1]?.mimeType, 'image/jpeg');
    assert.ok((content[1]?.data?.length ?? 0) > 1000);
    const bad = await client.callTool({ name: 'browser_click', arguments: { role: 'button' } });
    assert.equal(bad.isError, true);
    await act(s, 'page_check', { role: 'heading', name: 'Account settings', state: 'visible' });
  } finally {
    await client.close();
    await tools.close();
    await s.close();
  }
  const viewer = new ProofViewer(file(s, required(s.checks[0]).screenshot));
  assert.deepEqual(
    viewer.definitions().map((t) => [t.name, t.readOnly]),
    [['view_proof_screenshot', true]],
  );
  const image = await viewer.call('view_proof_screenshot', {});
  assert.ok(image instanceof ToolObservation);
  assert.equal(image.images[0]?.mimeType, 'image/png');
  await assert.rejects(viewer.call('browser_click', {}), /Tool is not allowed/);
});
