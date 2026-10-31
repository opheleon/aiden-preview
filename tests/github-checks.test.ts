import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readPullRequestChecks } from '../packages/tools/src/github-checks.js';

/**
 * A fake GitHub CLI on PATH. It answers `gh pr checks` like the real one: JSON on stdout with
 * exit 8 while checks run and exit 1 when one failed, "no checks reported" on stderr when the PR
 * has none, and an auth failure on request. PR numbers pick the answer.
 */
async function fakeGh(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'aiden-gh-checks-'));
  const script = `#!/bin/sh
if [ "$1 $2" != "pr checks" ] || [ "$4" != "--json" ]; then exit 2; fi
case "$3" in
  */pull/1) echo '[{"name":"build","state":"SUCCESS","bucket":"pass","link":"https://ci/1"}]' ;;
  */pull/2) echo '[{"name":"e2e","state":"IN_PROGRESS","bucket":"pending","link":""},{"name":"new","state":"X","bucket":"surprise"}]'; exit 8 ;;
  */pull/3) echo '[{"name":"lint","state":"FAILURE","bucket":"fail","link":null}]'; exit 1 ;;
  */pull/4) echo "no checks reported on the 'aiden/job-1' branch" >&2; exit 1 ;;
  */pull/5) echo 'not json' ;;
  *) echo "HTTP 401: token secret-123" >&2; exit 1 ;;
esac
`;
  await writeFile(path.join(dir, 'gh'), script);
  await chmod(path.join(dir, 'gh'), 0o755);
  return dir;
}

void test('pull request checks are read from gh even when it exits for failing or pending checks', async () => {
  const dir = await fakeGh();
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved ?? ''}`;
  try {
    const base = 'https://github.com/acme/api/pull';
    assert.deepEqual(await readPullRequestChecks(`${base}/1`), [
      { name: 'build', bucket: 'pass', link: 'https://ci/1' },
    ]);
    assert.deepEqual(
      (await readPullRequestChecks(`${base}/2`)).map((check) => check.bucket),
      ['pending', 'pending'],
    );
    assert.equal((await readPullRequestChecks(`${base}/3`))[0]?.bucket, 'fail');
    assert.deepEqual(await readPullRequestChecks(`${base}/4`), []);
    await assert.rejects(readPullRequestChecks(`${base}/5`), /could not read/);
    await assert.rejects(readPullRequestChecks(`${base}/6`), (error: Error) => {
      assert.match(error.message, /Check gh authentication/);
      assert.doesNotMatch(error.message, /secret-123/);
      return true;
    });
    await assert.rejects(
      readPullRequestChecks('https://github.com/acme/api/pull/1; rm -rf /'),
      /not a GitHub pull request URL/,
    );
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(readPullRequestChecks(`${base}/1`, stopped.signal), {
      name: 'AbortError',
    });
  } finally {
    process.env.PATH = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
