import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { parse } from 'yaml';

const exec = promisify(execFile);
const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8')) as {
  jobs: { publish: { steps: { name?: string; run?: string }[] } };
};
const script = workflow.jobs.publish.steps.find(
  (step) => step.name === 'Publish GitHub Release',
)!.run!;

// This CLI substitute records mutations. It never contacts GitHub or sees a real token.
const ghFixture = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const mode = process.env.MODE;
if (args.includes('--method')) {
  if (args.includes('PATCH')) { console.log('https://example.invalid/release/123'); }
  else if (args.some(a => a.startsWith('https://uploads.github.com/'))) {
    if (mode === 'upload-fails') process.exit(1);
    const file = args[args.indexOf('--input') + 1];
    fs.appendFileSync(process.env.UPLOADED, JSON.stringify({ name: file, state: 'uploaded', size: fs.statSync(file).size }) + '\\n');
    console.log(file);
  } else { console.log('123'); }
} else if (args.some(a => a.includes('/git/ref/'))) { console.log('{}'); }
else if (args.some(a => a.includes('/123/assets'))) {
  const assets = fs.readFileSync(process.env.UPLOADED, 'utf8').trim().split('\\n').map(JSON.parse);
  console.log(JSON.stringify([mode === 'missing-upload' ? assets.slice(1) : assets]));
} else {
  const releases = mode === 'existing' ? [{ tag_name: process.env.GITHUB_REF_NAME, draft: false }] :
    mode === 'draft' ? [{ tag_name: process.env.GITHUB_REF_NAME, draft: true }] : [];
  console.log(JSON.stringify([[], releases]));
}
`;

async function publishFixture(mode: string, version = '1.1.1') {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-release-policy-'));
  const calls = path.join(root, 'calls');
  const uploaded = path.join(root, 'uploaded');
  const { mkdir } = await import('node:fs/promises');
  const assets = path.join(root, 'assets');
  await mkdir(assets);
  await writeFile(path.join(root, 'gh'), ghFixture, { mode: 0o755 });
  await writeFile(calls, '');
  await writeFile(uploaded, '');
  const files = [
    `Aiden-${version}-arm64.dmg`,
    `Aiden-${version}-arm64.dmg.blockmap`,
    `Aiden-${version}-arm64.zip`,
    `Aiden-${version}-arm64.zip.blockmap`,
    version.includes('-') ? 'beta-mac.yml' : 'latest-mac.yml',
  ];
  for (const file of files) await writeFile(path.join(assets, file), 'synthetic artifact');
  const { stdout } = await exec('shasum', ['-a', '256', ...files], { cwd: assets });
  await writeFile(path.join(assets, 'SHA256SUMS.txt'), stdout);
  if (mode === 'missing-local') await rm(path.join(assets, files[0]!));
  if (mode === 'corrupt')
    await writeFile(path.join(assets, files[0]!), 'changed after attestation');
  // macOS ships shasum rather than GNU sha256sum. Keep the real checksum verification.
  await writeFile(path.join(root, 'sha256sum'), '#!/bin/sh\nexec shasum -a 256 "$@"\n', {
    mode: 0o755,
  });
  let failed = false;
  try {
    await exec('/bin/bash', ['-c', script], {
      cwd: assets,
      env: {
        PATH: `${root}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'synthetic/aiden',
        GITHUB_REF_NAME: `v${version}`,
        MODE: mode,
        CALLS: calls,
        UPLOADED: uploaded,
      },
    });
  } catch {
    failed = true;
  }
  const requests = (await readFile(calls, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  await rm(root, { recursive: true, force: true });
  return { failed, requests };
}

void test('publishing uploads all attested files before publishing the exact created release ID', async () => {
  for (const version of ['1.1.1', '1.1.1-beta.1']) {
    const { failed, requests } = await publishFixture('success', version);
    assert.equal(failed, false);
    const uploads = requests.filter((args) =>
      args.some((arg) => arg.startsWith('https://uploads.github.com/')),
    );
    assert.equal(uploads.length, 6);
    assert.ok(requests.some((args) => args.includes(`prerelease=${version.includes('-')}`)));
    assert.deepEqual(requests.at(-1), [
      'api',
      '--method',
      'PATCH',
      'repos/synthetic/aiden/releases/123',
      '-F',
      'draft=false',
      '--jq',
      '.html_url',
    ]);
  }
});

void test('duplicate tags, partial uploads, and corrupt or missing artifacts cannot publish', async () => {
  for (const mode of [
    'existing',
    'draft',
    'upload-fails',
    'missing-upload',
    'missing-local',
    'corrupt',
  ]) {
    const { failed, requests } = await publishFixture(mode);
    assert.equal(failed, true, mode);
    assert.ok(!requests.some((args) => args.includes('PATCH')), mode);
    if (['existing', 'draft', 'missing-local', 'corrupt'].includes(mode)) {
      assert.ok(!requests.some((args) => args.includes('POST')), mode);
    }
  }
});
