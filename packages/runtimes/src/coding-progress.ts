import path from 'node:path';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** Tool names that read, change, or search files, with the words members see. */
const verbs: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
};

/** Shell commands by what they do, checked in order; the first match names the step. */
const commands: [RegExp, string][] = [
  [
    /\b(pytest|unittest|jest|vitest|mocha|go test|cargo test|(npm|pnpm|yarn)( run)? test)\b/,
    'Running tests',
  ],
  [/\b(ruff|eslint|flake8|pyflakes|mypy|tsc|prettier|black)\b/, 'Checking the code'],
  [/\bgit commit\b/, 'Committing the change'],
  [/\bgit (status|diff|log|show|add|stash|ls-files|remote|branch)\b/, 'Reviewing the changes'],
  [/\b((pip|npm|pnpm|yarn|poetry|uv) (install|add|sync)|venv)\b/, 'Installing dependencies'],
  [/^\s*(cat|ls|head|tail|grep|rg|find|wc|tree|for f in)\b/, 'Reading the code'],
  [/\b(python3?|node)\b/, 'Running a script'],
];

/**
 * A shell command as a plain step. Writing a file names the file; otherwise the command's purpose.
 * Examples: `cat > tests/test_auth.py <<'EOF'` is "Writing test_auth.py"; `python3 -m pytest -q` is
 * "Running tests"; an unknown `make lint` is "Running make".
 */
export function shellStep(command: string): string {
  // Claude Code often prefixes commands with "cd <repo> &&"; the step is what follows.
  const first = command.split('\n')[0]!.replace(/^\s*(cd\s+\S+\s*(&&|;)\s*)+/, '');
  const target = [...first.matchAll(/(?:^|[^\d&>])>{1,2}\s*([\w./-]+)/g)]
    .map((match) => match[1]!)
    .find((file) => !file.startsWith('/dev/') && !file.startsWith('/tmp/'));
  if (target && !/\b(pytest|test)\b/.test(first)) return `Writing ${path.basename(target)}`;
  const known = commands.find(([pattern]) => pattern.test(first));
  if (known) return known[1];
  const program = first.trim().split(/\s+/)[0] ?? 'a command';
  return `Running ${path.basename(program)}`;
}

/** One tool call as a short line. Example: `{ name: 'Bash', input: { command: 'pytest -q' } }` is "Running tests". */
function describe(name: string, input: Record<string, unknown>): string {
  const file = typeof input.file_path === 'string' ? path.basename(input.file_path) : '';
  if (verbs[name]) return file ? `${verbs[name]} ${file}` : `${verbs[name]} a file`;
  if (name === 'Bash' && typeof input.command === 'string') return shellStep(input.command);
  if (name === 'Grep' || name === 'Glob') return 'Searching the code';
  if (name === 'TodoWrite') return 'Planning the change';
  if (name === 'StructuredOutput') return 'Writing up the result';
  return `Using ${name}`;
}

/**
 * What a Claude Code session is doing right now, in one line per tool call, so a team can watch a
 * coding task without opening a terminal. Text-only turns return nothing.
 * @param message One streamed SDK message.
 */
export function codingSteps(message: SDKMessage): string[] {
  if (message.type !== 'assistant') return [];
  const blocks = message.message.content as { type: string; name?: string; input?: unknown }[];
  return blocks.flatMap((block) =>
    block.type === 'tool_use' && block.name
      ? [describe(block.name, (block.input ?? {}) as Record<string, unknown>)]
      : [],
  );
}
