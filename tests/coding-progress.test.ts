import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { codingSteps } from '../packages/runtimes/src/coding-progress.js';

/** An assistant turn that calls one tool. */
function call(name: string, input: Record<string, unknown>): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't', name, input }] },
  } as unknown as SDKMessage;
}

void test('Claude Code tool calls read as plain steps a team can follow', () => {
  const steps = (
    [
      ['Bash', { command: "cat > tests/test_auth.py <<'EOF'\nimport x\nEOF" }],
      ['Bash', { command: 'python3 -m pytest -q 2>&1 | tail -5' }],
      ['Bash', { command: "git add -A && git commit -q -F - <<'EOF'" }],
      ['Bash', { command: 'git status --short' }],
      ['Bash', { command: 'pip install -r requirements.txt' }],
      ['Bash', { command: 'grep -rn "pytz" *.py' }],
      ['Bash', { command: "python3 - <<'EOF'\nprint(1)\nEOF" }],
      ['Bash', { command: 'make lint' }],
      ['Bash', { command: 'cd /work/calendar-ui && npm test' }],
      ['Edit', { file_path: '/repo/app/routes.py' }],
      ['Grep', { pattern: 'owner' }],
    ] as const
  ).flatMap(([name, input]) => codingSteps(call(name, input)));
  assert.deepEqual(steps, [
    'Writing test_auth.py',
    'Running tests',
    'Committing the change',
    'Reviewing the changes',
    'Installing dependencies',
    'Reading the code',
    'Running a script',
    'Running make',
    'Running tests',
    'Editing routes.py',
    'Searching the code',
  ]);
});
