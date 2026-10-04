import assert from 'node:assert/strict';
import test from 'node:test';

import { publishLinearTickets } from '../packages/core/src/linear-projects.js';
import { readTicketState, writeTicketState } from '../packages/core/src/ticket-storage.js';
import { syncTickets } from '../packages/core/src/ticket-sync.js';
import { ticketFixture } from './ticket-fixture.js';

/** Synthetic current Linear responses expose a public project alias plus its canonical UUID. */
async function fixture() {
  const f = await ticketFixture({ projects: true });
  f.linear.behavior.splitProjectIds = true;
  const state = await publishLinearTickets(f.engine, f.project.id, {
    connectionId: f.connection.id,
    teamId: 'team-books',
    fingerprint: f.settings.fingerprint,
    tools: f.settings.tools,
  });
  return { ...f, state };
}

void test('publishing stores Linear UUIDs and recovers legacy aliases plus an initially closed ticket without duplicate writes', async () => {
  const f = await fixture();
  try {
    const project = f.linear.projects.get('project-1')!;
    assert.equal(f.state.settings!.destination.provider, 'linear');
    assert.equal(f.state.linearProject!.id, project.uuid);
    assert.equal(f.issues.get('issue-1')!.project, project.uuid);
    assert.ok(f.state.records.every((r) => r.state === 'synced'));
    // Reproduce old saved data: alias destination and a created ticket that never passed read-back.
    const destination = f.state.settings!.destination;
    if (destination.provider !== 'linear') throw new Error('Fixture destination');
    destination.project = project.id;
    f.state.linearProject!.id = project.id;
    for (const record of f.state.records) {
      record.state = 'uncertain';
      record.pendingHash = record.contentHash;
      delete record.contentHash;
      delete record.remoteStatus;
      delete record.checkedAt;
    }
    f.issues.get('issue-1')!.status = 'Done';
    f.issues.get('issue-1')!.statusType = 'completed';
    await writeTicketState(f.store, f.project.id, f.state);
    f.calls.length = 0;
    const recovered = await syncTickets(f.engine, f.project.id);
    assert.equal(recovered.error, undefined);
    assert.equal(recovered.linearProject!.id, project.uuid);
    assert.ok(recovered.records.every((r) => r.state === 'synced'));
    assert.equal(recovered.records[0]!.remoteStatus, 'Done');
    assert.equal(recovered.records[0]!.remoteStatusType, 'completed');
    assert.equal(recovered.needsAssessment, true);
    assert.deepEqual(f.calls, ['get', 'get']);
    assert.equal(f.issues.size, 2);
    const repeated = await syncTickets(f.engine, f.project.id);
    assert.equal(repeated.externalChangeAt, recovered.externalChangeAt);
    assert.equal(f.linear.projects.size, 1);
    assert.deepEqual(await readTicketState(f.store, f.project.id), repeated);
  } finally {
    await f.close();
  }
});

void test('legacy project normalization fails closed on foreign identity, team, marker, or local linkage', async () => {
  const f = await fixture();
  try {
    const remote = f.linear.projects.get('project-1')!;
    const original = structuredClone(remote);
    const state = structuredClone(f.state);
    if (state.settings!.destination.provider !== 'linear') throw new Error('Fixture destination');
    state.settings!.destination.project = remote.id;
    state.linearProject!.id = remote.id;
    for (const bad of ['identity', 'team', 'marker', 'link'] as const) {
      Object.assign(remote, structuredClone(original));
      const saved = structuredClone(state);
      if (bad === 'identity') remote.id = 'foreign-project';
      if (bad === 'team') remote.teams = [{ id: 'other-team' }];
      if (bad === 'marker') remote.description = 'Human edit';
      if (bad === 'link') saved.linearProject!.connectionId = 'other-connection';
      await writeTicketState(f.store, f.project.id, saved);
      f.calls.length = 0;
      const rejected = await syncTickets(f.engine, f.project.id);
      assert.match(rejected.error!, /could not be verified|does not match/);
      assert.equal(rejected.linearProject!.id, original.id);
      assert.deepEqual(f.calls, [], 'no issue operations happen before destination verification');
    }
  } finally {
    await f.close();
  }
});
