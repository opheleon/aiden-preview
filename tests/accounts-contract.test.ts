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
  'task-approve.json': AccountTaskSchema,
  'task-cancel.json': AccountTaskSchema,
  'task-check.json': AccountTaskSchema,
  'task-fail.json': AccountTaskSchema,
  'task-heartbeat.json': AccountTaskSchema,
  'task-human-done.json': AccountTaskSchema,
  'task-needs-human.json': AccountTaskSchema,
  'task-review.json': AccountTaskSchema,
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

void test('the server sends every task board field, so defaults only cover older servers', async () => {
  const fields = [
    'role',
    'reviewerUserId',
    'parentTaskId',
    'revisionOf',
    'verification',
    'review',
    'checks',
    'timeline',
  ];
  for (const file of [
    'task-review.json',
    'task-approve.json',
    'task-check.json',
    'task-complete.json',
  ]) {
    const raw = JSON.parse(await readFile(path.join(folder, file), 'utf8')) as Record<
      string,
      unknown
    >;
    for (const field of fields) assert.ok(field in raw, `${file} has no ${field}`);
  }
  const review = AccountTaskSchema.parse(
    JSON.parse(await readFile(path.join(folder, 'task-review.json'), 'utf8')),
  );
  assert.equal(review.status, 'review');
  assert.ok(review.reviewerUserId);
  const checked = AccountTaskSchema.parse(
    JSON.parse(await readFile(path.join(folder, 'task-check.json'), 'utf8')),
  );
  assert.deepEqual([checked.status, checked.verification], ['done', 'passed']);
  const state = AccountStateSchema.parse(
    JSON.parse(await readFile(path.join(folder, 'account-state.json'), 'utf8')),
  );
  assert.ok(state.members.every((member) => Array.isArray(member.roles)));
});
