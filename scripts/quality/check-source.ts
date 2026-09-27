import { readFile } from 'node:fs/promises';

import { repositoryFiles } from './files.js';
import { inspectSource } from './source-policy.js';

const errors: string[] = [];
for (const file of await repositoryFiles())
  errors.push(...inspectSource(file, await readFile(file, 'utf8')));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
