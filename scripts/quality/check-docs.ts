import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { repositoryFiles } from './files.js';

const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const commands = new Set([
  'install',
  'exec',
  'add',
  'remove',
  'update',
  'audit',
  'approve-builds',
  'run',
  ...Object.keys(manifest.scripts),
]);
const errors: string[] = [];
for (const file of (await repositoryFiles()).filter((file) => file.endsWith('.md'))) {
  const source = await readFile(file, 'utf8');
  const prose = source.replace(/```[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]?.split('#')[0];
    if (!target || /^(?:https?:|mailto:|data:)/.test(target)) continue;
    try {
      await access(path.resolve(path.dirname(file), decodeURIComponent(target)));
    } catch {
      errors.push(`${file}: missing local link ${target}`);
    }
  }
  const commandExamples = [...source.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)]
    .map((match) => match[0])
    .join('\n');
  for (const match of commandExamples.matchAll(/\bpnpm\s+(?:run\s+)?([a-z][\w:-]*)/g)) {
    const command = match[1];
    if (command && !commands.has(command)) errors.push(`${file}: unknown pnpm command ${command}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
