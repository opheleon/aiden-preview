import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import type { z } from 'zod/v3';

import {
  AccountProjectSchema,
  AccountStateSchema,
  AccountSummarySchema,
  AccountTaskSchema,
  ApiErrorSchema,
  InviteSchema,
  MemberAdminSchema,
  MeSchema,
  ProjectCreatedSchema,
  TaskEventSchema,
  WorkAnswerSchema,
} from '../packages/contracts/src/accounts-api.js';

const folder = path.join(import.meta.dirname, '../packages/contracts/fixtures/accounts');
/** Which vendored schema each server example response must satisfy. */
const schemas: Record<string, z.ZodTypeAny> = {
  'account-state.json': AccountStateSchema,
  'account.json': AccountSummarySchema,
  'error.json': ApiErrorSchema,
  'invite.json': InviteSchema,
  'me.json': MeSchema,
  'member-admin.json': MemberAdminSchema,
  'project-created.json': ProjectCreatedSchema,
  'project.json': AccountProjectSchema,
  'task-complete.json': AccountTaskSchema,
  'task-events.json': TaskEventSchema.array(),
  'task-cancel.json': AccountTaskSchema,
  'task-fail.json': AccountTaskSchema,
  'task-heartbeat.json': AccountTaskSchema,
  'task-human-done.json': AccountTaskSchema,
  'task-needs-human.json': AccountTaskSchema,
  'work-assign.json': WorkAnswerSchema,
  'work-hold.json': WorkAnswerSchema,
};

void test('every Accounts API fixture parses with the vendored contract', async () => {
  const files = (await readdir(folder)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, Object.keys(schemas).sort(), 'a server fixture has no matching schema');
  for (const file of files) {
    const parsed = schemas[file]!.safeParse(
      JSON.parse(await readFile(path.join(folder, file), 'utf8')),
    );
    assert.ok(parsed.success, `${file}: ${parsed.success ? '' : parsed.error.message}`);
  }
});
