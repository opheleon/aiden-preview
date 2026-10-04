import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { commitBaseline } from '../packages/core/src/baseline.js';
import { atomic } from '../packages/core/src/storage.js';
import {
  readTicketState,
  saveTicketSettings,
  writeTicketState,
} from '../packages/core/src/ticket-storage.js';
import { syncTickets } from '../packages/core/src/ticket-sync.js';
import { ticketFixture } from './ticket-fixture.js';

void test('configured tickets publish in plan order, verify, monitor status, update scope, and preserve human edits', async () => {
  const f = await ticketFixture();
  try {
    assert.deepEqual((await syncTickets(f.engine, f.project.id)).records, []);
    assert.deepEqual(f.calls, []);
    await f.enable();
    const first = await syncTickets(f.engine, f.project.id);
    assert.deepEqual(
      first.records.map((r) => r.state),
      ['synced', 'synced'],
    );
    assert.deepEqual(f.calls, ['search', 'create', 'get', 'search', 'create', 'get']);
    assert.match(
      f.issues.get('issue-2')!.description,
      /Prerequisite tickets:\nF-1: https:\/\/linear.app/,
    );
    const restored = await readTicketState(f.store, f.project.id);
    assert.deepEqual(restored, first, 'identities survive worker restarts');
    await Promise.all([syncTickets(f.engine, f.project.id), syncTickets(f.engine, f.project.id)]);
    assert.equal(f.calls.filter((c) => c === 'create').length, 2);
    f.issues.get('issue-1')!.status = 'Done';
    const checked = await syncTickets(f.engine, f.project.id);
    assert.equal(checked.records[0]!.remoteStatus, 'Done');
    assert.equal(checked.needsAssessment, true);
    assert.equal(checked.records[0]!.remoteStatusChangedAt, checked.externalChangeAt);
    assert.equal(
      (await syncTickets(f.engine, f.project.id)).records[0]!.remoteStatusChangedAt,
      checked.records[0]!.remoteStatusChangedAt,
    );
    assert.equal(
      (await f.engine.state(f.project.id)).runs.length,
      0,
      'tracker Done never fabricates an assessment',
    );
    f.product.deliveryPlan![0]!.title = 'Updated vertical feature';
    await commitBaseline(f.store, f.project.id, f.product, f.project.context);
    await syncTickets(f.engine, f.project.id);
    assert.equal(f.issues.get('issue-1')!.title, 'Updated vertical feature');
    f.issues.get('issue-1')!.description += '\nHuman acceptance criterion';
    const conflict = await syncTickets(f.engine, f.project.id);
    assert.equal(conflict.records[0]!.state, 'conflict');
    assert.match(f.issues.get('issue-1')!.description, /Human acceptance criterion/);
    f.product.requirements = f.product.requirements.slice(0, 1);
    f.product.deliveryPlan = f.product.deliveryPlan!.slice(0, 1);
    await commitBaseline(f.store, f.project.id, f.product, f.project.context);
    assert.equal((await syncTickets(f.engine, f.project.id)).records[1]!.state, 'retired');
    assert.equal(f.issues.size, 2, 'retiring a feature preserves the external issue');
    await assert.rejects(
      saveTicketSettings(f.engine, f.project.id, {
        ...f.settings,
        destination: { ...f.settings.destination, project: 'Another' },
      }),
      /destination/,
    );
  } finally {
    await f.close();
  }
});

void test('ambiguous creates persist intent and recover with search plus GET without duplicates', async () => {
  const f = await ticketFixture();
  try {
    await f.enable();
    f.behavior.failAfterCreate = true;
    const failed = await syncTickets(f.engine, f.project.id);
    assert.deepEqual(
      failed.records.map((r) => r.state),
      ['uncertain', 'uncertain'],
    );
    assert.equal(f.issues.size, 2);
    f.behavior.failAfterCreate = false;
    f.behavior.missingSearch = true;
    await syncTickets(f.engine, f.project.id);
    assert.equal(f.calls.filter((c) => c === 'create').length, 2);
    f.behavior.missingSearch = false;
    const recovered = await syncTickets(f.engine, f.project.id);
    assert.deepEqual(
      recovered.records.map((r) => r.state),
      ['synced', 'synced'],
    );
    assert.equal(f.issues.size, 2);
    assert.equal(f.calls.filter((c) => c === 'create').length, 2);
  } finally {
    await f.close();
  }
});

void test('blocking unknowns publish only draft scope, including dependent features', async () => {
  const f = await ticketFixture();
  try {
    await f.enable();
    await atomic(path.join(f.store.project(f.project.id), 'calls.json'), [
      {
        id: 'call',
        kind: 'decision',
        status: 'open',
        requirementId: 'REQ-1',
        edgeCaseId: null,
        question: 'Who can see books?',
        assumption: 'Visibility needs a decision.',
        options: [],
        owner: 'you',
        askedAt: new Date().toISOString(),
        answer: null,
        answeredAt: null,
        runId: null,
      },
    ]);
    await syncTickets(f.engine, f.project.id);
    for (const issue of f.issues.values()) {
      assert.match(issue.title, /^\[Blocked\]/);
      assert.match(issue.description, /Who can see books/);
      assert.doesNotMatch(issue.description, /## Acceptance criteria|## Known remaining work/);
    }
  } finally {
    await f.close();
  }
});

void test('tool changes and scope mismatch stop writes; disabling works offline; agents retain read-only access', async () => {
  const f = await ticketFixture();
  try {
    await f.enable();
    await assert.rejects(
      f.engine.integrations.call(f.connection.id, 'save_issue', {}),
      /not approved/,
    );
    await syncTickets(f.engine, f.project.id);
    f.issues.get('issue-1')!.project = 'Other';
    assert.equal((await syncTickets(f.engine, f.project.id)).records[0]!.state, 'error');
    f.behavior.changedContract = true;
    const stopped = await syncTickets(f.engine, f.project.id);
    assert.ok(stopped.records.every((r) => r.state === 'error'));
    assert.equal(f.calls.filter((c) => c === 'update').length, 0);
    await saveTicketSettings(f.engine, f.project.id, { ...f.settings, enabled: false });
    const count = f.calls.length;
    await syncTickets(f.engine, f.project.id);
    assert.equal(f.calls.length, count);
    await assert.rejects(
      f.engine.integrations.ticketOperation({ ...f.settings, enabled: false }, 'create', {
        title: 'No',
        description: 'No',
      }),
      /disabled/,
    );
  } finally {
    await f.close();
  }
});

void test('rich mention read-back recovers pending writes for known tickets and preserves altered destinations', async () => {
  const f = await ticketFixture();
  try {
    await f.enable();
    const first = await syncTickets(f.engine, f.project.id);
    const known = first.records[0]!;
    f.product.deliveryPlan![1]!.outcome += ` Follow ${known.issueId}.`;
    await commitBaseline(f.store, f.project.id, f.product, f.project.context);
    const written = await syncTickets(f.engine, f.project.id);
    const record = written.records[1]!;
    record.pendingHash = record.contentHash!;
    delete record.contentHash;
    record.state = 'conflict';
    await writeTicketState(f.store, f.project.id, written);
    const issue = f.issues.get('issue-2')!;
    const mention = `<issue id="11111111-1111-4111-8111-111111111111" href="${known.url}">${known.issueId}</issue>`;
    issue.description = issue.description.replace(`Follow ${known.issueId}.`, `Follow ${mention}.`);
    const recovered = await syncTickets(f.engine, f.project.id);
    assert.equal(recovered.records[1]!.state, 'synced');
    assert.equal(recovered.records[1]!.pendingHash, undefined);
    assert.equal(recovered.records[1]!.contentHash, recovered.records[1]!.observedHash);
    issue.description = issue.description.replace(
      known.url!,
      'https://linear.app/another/issue/OTHER-1',
    );
    const edited = issue.description;
    assert.equal((await syncTickets(f.engine, f.project.id)).records[1]!.state, 'conflict');
    assert.equal(issue.description, edited);
    assert.equal(f.issues.size, 2);
  } finally {
    await f.close();
  }
});
