import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

void test('unimported runtime source lowers measured coverage and fails the configured floor', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'aiden-coverage-policy-')));
  await writeFile(path.join(root, 'covered.cjs'), 'module.exports = 1;\n');
  await writeFile(
    path.join(root, 'untested.cjs'),
    'module.exports = function untested() {\n' + '  Math.random();\n'.repeat(20) + '};\n',
  );
  const command = path.resolve('node_modules/c8/bin/c8.js');
  const exec = promisify(execFile);
  await assert.rejects(
    exec(
      process.execPath,
      [
        command,
        '--all',
        '--src',
        root,
        '--include',
        '**/*.cjs',
        '--reporter=json-summary',
        '--reports-dir',
        path.join(root, 'coverage'),
        '--check-coverage',
        '--lines',
        '80',
        process.execPath,
        path.join(root, 'covered.cjs'),
      ],
      { cwd: root },
    ),
    (error) => {
      assert.match(String(error), /coverage|Coverage/);
      return true;
    },
  );
  const summary = JSON.parse(
    await readFile(path.join(root, 'coverage', 'coverage-summary.json'), 'utf8'),
  );
  assert.equal(summary[path.join(root, 'untested.cjs')].lines.pct, 0);
  assert.ok(summary.total.lines.pct < 80);
});
