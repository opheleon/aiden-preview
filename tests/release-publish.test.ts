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
const aliasScript = workflow.jobs.publish.steps.find(
  (step) => step.name === 'Create permanent download aliases',
)!.run!;
const fixedBetaScript = workflow.jobs.publish.steps.find(
  (step) => step.name === 'Point the fixed Aiden Beta downloads at this build',
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
  const tag = 'v' + process.env.VERSION;
  const releases = mode === 'existing' ? [{ tag_name: tag, draft: false }] :
    mode === 'draft' ? [{ tag_name: tag, draft: true }] : [];
  console.log(JSON.stringify([[], releases]));
}
`;

/**
 * Run the alias and publish steps against synthetic artifacts, the way the plan job names them.
 * @param mode Which failure to simulate, or `success`.
 * @param version The version the plan job computed.
 * @param flavor `production`, or `beta` for an Aiden Beta pre-release.
 */
async function publishFixture(mode: string, version = '1.1.1', flavor = 'production') {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-release-policy-'));
  const calls = path.join(root, 'calls');
  const uploaded = path.join(root, 'uploaded');
  const { mkdir } = await import('node:fs/promises');
  const assets = path.join(root, 'assets');
  await mkdir(assets);
  await writeFile(path.join(root, 'gh'), ghFixture, { mode: 0o755 });
  await writeFile(calls, '');
  await writeFile(uploaded, '');
  const beta = flavor === 'beta';
  const prefix = beta ? 'Aiden-Beta' : 'Aiden';
  const channel = beta ? 'aidenbeta' : version.includes('-') ? 'beta' : 'latest';
  const plan = { FLAVOR: flavor, VERSION: version, PREFIX: prefix, CHANNEL: channel };
  const files = [
    `${prefix}-${version}-arm64.dmg`,
    `${prefix}-${version}-arm64.dmg.blockmap`,
    `${prefix}-${version}-arm64.zip`,
    `${prefix}-${version}-arm64.zip.blockmap`,
    `${channel}-mac.yml`,
    `${prefix}-${version}-x64.exe`,
    `${prefix}-${version}-x64.exe.blockmap`,
    `${channel}.yml`,
  ];
  if (mode === 'missing-windows') files.splice(5, 3);
  for (const file of files) await writeFile(path.join(assets, file), 'synthetic artifact');
  // The alias step runs only for production; README and Teams download links depend on it.
  if (!beta) {
    const alias = exec('/bin/bash', ['-c', aliasScript], {
      cwd: assets,
      env: { ...process.env, ...plan },
    });
    // Without the Windows installer there is nothing to alias, so the job stops before publishing.
    if (mode === 'missing-windows') {
      await assert.rejects(alias);
      await rm(root, { recursive: true, force: true });
      return { failed: true, requests: [] as string[][] };
    }
    await alias;
    assert.deepEqual(
      await readFile(path.join(assets, 'Aiden-arm64.dmg')),
      await readFile(path.join(assets, files[0]!)),
    );
    assert.deepEqual(
      await readFile(path.join(assets, 'Aiden-x64.exe')),
      await readFile(path.join(assets, `${prefix}-${version}-x64.exe`)),
    );
    files.push('Aiden-arm64.dmg', 'Aiden-x64.exe');
  }
  if (mode === 'different-alias')
    await writeFile(path.join(assets, 'Aiden-arm64.dmg'), 'different installer');
  const { stdout } = await exec('shasum', ['-a', '256', ...files], { cwd: assets });
  await writeFile(path.join(assets, 'SHA256SUMS.txt'), stdout);
  if (mode === 'missing-local') await rm(path.join(assets, files[0]!));
  if (mode === 'missing-alias') await rm(path.join(assets, 'Aiden-arm64.dmg'));
  if (mode === 'different-windows-alias')
    await writeFile(path.join(assets, 'Aiden-x64.exe'), 'different installer');
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
        GITHUB_SHA: 'synthetic-sha',
        ...plan,
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
    assert.equal(uploads.length, 11);
    assert.ok(uploads.some((args) => args.includes('Aiden-arm64.dmg')));
    assert.ok(uploads.some((args) => args.includes('Aiden-x64.exe')));
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

void test('Aiden Beta publishes a pre-release on its own channel, tagged at the pushed commit', async () => {
  const version = '1.1.1-aidenbeta.42';
  const { failed, requests } = await publishFixture('success', version, 'beta');
  assert.equal(failed, false);
  const uploads = requests.filter((args) =>
    args.some((arg) => arg.startsWith('https://uploads.github.com/')),
  );
  assert.equal(uploads.length, 9);
  assert.ok(!uploads.some((args) => args.some((arg) => arg.endsWith('name=Aiden-arm64.dmg'))));
  for (const file of ['aidenbeta-mac.yml', 'aidenbeta.yml', `Aiden-Beta-${version}-arm64.zip`])
    assert.ok(
      uploads.some((args) => args.some((arg) => arg.endsWith(`name=${file}`))),
      file,
    );
  const create = requests.find((args) => args.includes('draft=true'))!;
  for (const field of [
    `tag_name=v${version}`,
    'target_commitish=synthetic-sha',
    `name=Aiden Beta ${version}`,
    'prerelease=true',
  ])
    assert.ok(create.includes(field), field);
  // Beta tags do not exist before publishing, so there is no tag lookup.
  assert.ok(!requests.some((args) => args.some((arg) => arg.includes('/git/ref/'))));
  assert.ok(requests.at(-1)!.includes('draft=false'));
  const { failed: duplicate } = await publishFixture('existing', version, 'beta');
  assert.equal(duplicate, true);
});

void test('duplicate tags, partial uploads, and corrupt or missing artifacts cannot publish', async () => {
  for (const mode of [
    'existing',
    'draft',
    'upload-fails',
    'missing-upload',
    'missing-local',
    'missing-windows',
    'missing-alias',
    'different-alias',
    'different-windows-alias',
    'corrupt',
  ]) {
    const { failed, requests } = await publishFixture(mode);
    assert.equal(failed, true, mode);
    assert.ok(!requests.some((args) => args.includes('PATCH')), mode);
    if (
      [
        'existing',
        'draft',
        'missing-local',
        'missing-windows',
        'missing-alias',
        'different-alias',
        'different-windows-alias',
        'corrupt',
      ].includes(mode)
    ) {
      assert.ok(!requests.some((args) => args.includes('POST')), mode);
    }
  }
});

// This CLI substitute answers the fixed Aiden Beta step: no fixed release yet, or one that already
// holds the previous build's files. It records every call and never contacts GitHub.
const fixedGhFixture = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const existing = process.env.MODE === 'existing';
const url = args.find((a) => a.startsWith('repos/') || a.startsWith('https://'));
if (args.includes('POST') && url.startsWith('https://uploads.github.com/')) {
  console.log(url.includes('next-Aiden-Beta-arm64.dmg') ? '501' : '502');
} else if (args.includes('POST')) { console.log('900'); }
else if (args.includes('PATCH') || args.includes('DELETE')) { console.log('ok'); }
else if (url.endsWith('/assets?per_page=100')) {
  console.log(JSON.stringify([existing ? [
    { id: 11, name: 'Aiden-Beta-arm64.dmg' },
    { id: 12, name: 'Aiden-Beta-x64.exe' },
    { id: 13, name: 'next-Aiden-Beta-x64.exe' },
  ] : []]));
} else {
  console.log(JSON.stringify([[{ tag_name: 'v1.1.1-aidenbeta.41', id: 7 }].concat(
    existing ? [{ tag_name: 'aiden-beta', id: 900 }] : [])]));
}
`;

/**
 * Run the fixed Aiden Beta step against a substitute GitHub CLI.
 * @param mode `new` when no fixed release exists yet, or `existing`.
 */
async function fixedBetaFixture(mode: 'new' | 'existing') {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-fixed-beta-'));
  const calls = path.join(root, 'calls');
  const version = '1.1.1-aidenbeta.42';
  await writeFile(path.join(root, 'gh'), fixedGhFixture, { mode: 0o755 });
  await writeFile(calls, '');
  for (const file of [`Aiden-Beta-${version}-arm64.dmg`, `Aiden-Beta-${version}-x64.exe`])
    await writeFile(path.join(root, file), 'synthetic artifact');
  await exec('/bin/bash', ['-c', fixedBetaScript], {
    cwd: root,
    env: {
      PATH: `${root}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'synthetic/aiden',
      GITHUB_SHA: 'synthetic-sha',
      VERSION: version,
      MODE: mode,
      CALLS: calls,
    },
  });
  const requests = (await readFile(calls, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
  await rm(root, { recursive: true, force: true });
  return requests;
}

void test('the first Aiden Beta creates a never-latest pre-release with fixed file names', async () => {
  const requests = await fixedBetaFixture('new');
  const create = requests.find(
    (args) => args.includes('POST') && args.includes('repos/synthetic/aiden/releases'),
  )!;
  for (const field of [
    'tag_name=aiden-beta',
    'target_commitish=synthetic-sha',
    'prerelease=true',
    'draft=false',
    'make_latest=false',
  ])
    assert.ok(create.includes(field), field);
  assert.ok(!requests.some((args) => args.includes('DELETE')));
  const renames = requests.filter((args) => args.some((a) => a.includes('/releases/assets/')));
  assert.deepEqual(
    renames.map((args) => [args.find((a) => a.includes('/releases/assets/')), args.at(-3)]),
    [
      ['repos/synthetic/aiden/releases/assets/501', 'name=Aiden-Beta-arm64.dmg'],
      ['repos/synthetic/aiden/releases/assets/502', 'name=Aiden-Beta-x64.exe'],
    ],
  );
});

void test('later Aiden Betas move the tag and replace the fixed files only after uploading', async () => {
  const requests = await fixedBetaFixture('existing');
  assert.ok(
    !requests.some(
      (args) => args.includes('POST') && args.includes('repos/synthetic/aiden/releases'),
    ),
  );
  const index = (match: (args: string[]) => boolean) => requests.findIndex(match);
  const tagMove = index((args) => args.includes('repos/synthetic/aiden/git/refs/tags/aiden-beta'));
  assert.ok(requests[tagMove]!.includes('sha=synthetic-sha'));
  assert.ok(requests[tagMove]!.includes('force=true'));
  const edit = requests.find((args) => args.includes('repos/synthetic/aiden/releases/900'))!;
  assert.ok(edit.includes('make_latest=false'));
  const upload = (name: string) =>
    index((args) => args.some((a) => a.endsWith(`assets?name=next-${name}`)));
  const remove = (id: number) =>
    index(
      (args) =>
        args.includes('DELETE') && args.includes(`repos/synthetic/aiden/releases/assets/${id}`),
    );
  // The old file goes only once its replacement is uploaded; a leftover temporary upload goes first.
  assert.ok(upload('Aiden-Beta-arm64.dmg') < remove(11));
  assert.ok(remove(13) < upload('Aiden-Beta-x64.exe'));
  assert.ok(upload('Aiden-Beta-x64.exe') < remove(12));
});
