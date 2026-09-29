import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isLocalHost,
  loadVerificationConfig,
  parseAppUrl,
  redactor,
  settingsFile,
  verificationTarget,
} from '../packages/verification/src/index.js';

void test('only loopback hosts and exactly configured origins can be verified', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost'])
    assert.ok(isLocalHost(host));
  assert.equal(isLocalHost('localhost.example.com'), false);
  assert.equal(
    verificationTarget('http://localhost:3000/app', []).href,
    'http://localhost:3000/app',
  );
  assert.equal(
    verificationTarget('https://beta.example.com/start', ['https://beta.example.com']).origin,
    'https://beta.example.com',
  );
  assert.throws(
    () => verificationTarget('https://beta.example.com', []),
    /save it as this project's app URL \(App URL on its overview\)/,
  );
  assert.throws(
    () => verificationTarget('https://beta.example.com:8443', ['https://beta.example.com']),
    /not allowed/,
  );
  assert.throws(() => verificationTarget('not a url', []), /full URL/);
  assert.throws(() => verificationTarget('file:///etc/passwd', []), /http and https/);
  assert.throws(
    () => verificationTarget('http://me:secret@localhost:3000', []),
    /Remove credentials/,
  );
  assert.equal(parseAppUrl('https://beta.example.com').href, 'https://beta.example.com/');
  assert.throws(() => parseAppUrl('ftp://beta.example.com'), /http and https/);
});

void test('settings default safely, require private credential files, and prefer environment credentials', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-verify-policy-'));
  assert.deepEqual(await loadVerificationConfig(dir, {}), { allowedOrigins: [], stepLimit: 25 });
  await writeFile(settingsFile(dir), '{ nope');
  await assert.rejects(loadVerificationConfig(dir, {}), /not valid JSON/);
  await writeFile(
    settingsFile(dir),
    JSON.stringify({ allowedOrigins: ['https://beta.example.com'] }),
  );
  await chmod(settingsFile(dir), 0o644);
  assert.deepEqual((await loadVerificationConfig(dir, {})).allowedOrigins, [
    'https://beta.example.com',
  ]);
  await writeFile(
    settingsFile(dir),
    JSON.stringify({
      credentials: { username: 'tester', password: 'pw-from-file' },
      stepLimit: 10,
    }),
  );
  await chmod(settingsFile(dir), 0o644);
  await assert.rejects(loadVerificationConfig(dir, {}), /chmod 600/);
  await chmod(settingsFile(dir), 0o600);
  const fromFile = await loadVerificationConfig(dir, {});
  assert.deepEqual(fromFile.credentials, { username: 'tester', password: 'pw-from-file' });
  assert.equal(fromFile.stepLimit, 10);
  const fromEnv = await loadVerificationConfig(dir, {
    AIDEN_VERIFY_USERNAME: 'env-user',
    AIDEN_VERIFY_PASSWORD: 'env-pass',
  });
  assert.deepEqual(fromEnv.credentials, { username: 'env-user', password: 'env-pass' });
  await assert.rejects(loadVerificationConfig(dir, { AIDEN_VERIFY_USERNAME: 'x' }), /or neither/);
  // A saved app URL is the user configuring that origin, so it joins the allowlist for the run.
  await writeFile(
    settingsFile(dir),
    JSON.stringify({
      url: 'https://beta.example.com/app',
      allowedOrigins: ['https://auth.example.com'],
    }),
  );
  const saved = await loadVerificationConfig(dir, {});
  assert.equal(saved.url, 'https://beta.example.com/app');
  assert.deepEqual(saved.allowedOrigins, ['https://auth.example.com', 'https://beta.example.com']);
  assert.equal(
    verificationTarget('https://beta.example.com/other', saved.allowedOrigins).pathname,
    '/other',
  );
  await writeFile(settingsFile(dir), JSON.stringify({ url: 'file:///etc/passwd' }));
  await assert.rejects(loadVerificationConfig(dir, {}), /http and https/);
  await writeFile(settingsFile(dir), JSON.stringify({ unexpected: true }));
  await assert.rejects(loadVerificationConfig(dir, {}));
  const unreadable = path.join(dir, 'nested');
  await writeFile(unreadable, 'file where a directory is expected');
  await assert.rejects(loadVerificationConfig(unreadable, {}), /ENOTDIR/);
});

void test('redaction hides every secret, longest first, and ignores empty values', () => {
  const redact = redactor(['', 'pass', 'password123']);
  assert.equal(
    redact('typed password123 then pass'),
    'typed [test credential] then [test credential]',
  );
  assert.equal(redactor([])('unchanged'), 'unchanged');
});
