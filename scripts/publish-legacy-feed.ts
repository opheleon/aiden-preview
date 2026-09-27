// Points installs that still use the legacy CloudFront feed (1.1.0 and earlier) at a published
// GitHub Release. Only the manifest is uploaded: its file URLs are rewritten to the release's
// own download URLs, so those installs receive the same attested ZIP as everyone else. Once they
// update, the new build reads GitHub Releases directly.
//
//   node --import tsx scripts/publish-legacy-feed.ts v1.2.0 --dry-run
//   AIDEN_UPDATE_S3_URI=s3://YOUR-BUCKET/desktop/prod/mac/latest node --import tsx scripts/publish-legacy-feed.ts v1.2.0
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod/v3';

const [tag, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
  throw new Error(
    'Pass a stable release tag, for example v1.2.0. Beta releases never use the legacy feed.',
  );
}
const destination = process.env.AIDEN_UPDATE_S3_URI?.replace(/\/$/, '');
if (!dryRun && !destination?.startsWith('s3://')) {
  throw new Error('Set AIDEN_UPDATE_S3_URI to the legacy S3 feed prefix, or pass --dry-run.');
}

const packageJson = z
  .object({
    build: z.object({
      publish: z.array(
        z.object({
          provider: z.string(),
          owner: z.string().optional(),
          repo: z.string().optional(),
        }),
      ),
    }),
  })
  .parse(JSON.parse(await readFile('package.json', 'utf8')));
const github = packageJson.build.publish.find((entry) => entry.provider === 'github');
if (!github?.owner || !github.repo)
  throw new Error('A GitHub release repository must be configured.');
const { owner, repo } = github;
const repository = `${owner}/${repo}`;
const downloadBase = `https://github.com/${repository}/releases/download/${tag}/`;

/** Run a release utility and reject failures without uploading a partial manifest. */
function run(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}.`)),
    );
  });
}

const workDirectory = await mkdtemp(path.join(tmpdir(), 'aiden-legacy-feed-'));
try {
  const manifestPath = path.join(workDirectory, 'latest-mac.yml');
  await run('gh', [
    'release',
    'download',
    tag,
    '--repo',
    repository,
    '--pattern',
    'latest-mac.yml',
    '--dir',
    workDirectory,
  ]);

  const original = await readFile(manifestPath, 'utf8');
  const expectedVersion = tag.slice(1);
  if (!new RegExp(`^version: ${expectedVersion.replaceAll('.', '\\.')}$`, 'm').test(original)) {
    throw new Error(`latest-mac.yml in ${tag} does not describe version ${expectedVersion}.`);
  }
  // Only file names change; versions, sizes, and SHA-512 digests stay exactly as released.
  const rewritten = original.replace(
    /^(\s*(?:- )?(?:url|path): )(?!https:)(\S+)$/gm,
    (_: string, prefix: string, file: string) =>
      `${prefix}${downloadBase}${encodeURIComponent(file)}`,
  );
  await writeFile(manifestPath, rewritten);
  process.stdout.write(rewritten);

  if (dryRun) {
    process.stdout.write('\nDry run: nothing was uploaded.\n');
  } else {
    await run('aws', [
      's3',
      'cp',
      manifestPath,
      `${destination}/latest-mac.yml`,
      '--cache-control',
      'no-cache,no-store,must-revalidate',
      '--content-type',
      'text/yaml',
    ]);
    process.stdout.write(`\nLegacy feed ${destination} now points to ${repository} ${tag}.\n`);
  }
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
