import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { commitBaseline } from '../packages/core/src/baseline.js';
import { linearTeams, publishLinearTickets } from '../packages/core/src/linear-projects.js';
import { atomic } from '../packages/core/src/storage.js';
import { readTicketState, saveTicketSettings } from '../packages/core/src/ticket-storage.js';
import { createMethods, type RuntimeControls } from '../packages/core/src/worker-methods.js';
import { ticketFixture } from './ticket-fixture.js';

function input(f: Awaited<ReturnType<typeof ticketFixture>>) {
  return {
    connectionId: f.connection.id,
    teamId: 'team-books',
    fingerprint: f.settings.fingerprint,
    tools: f.settings.tools,
  };
}

void test('team discovery and scope-named projects produce one verified destination per Aiden project', async () => {
  const f = await ticketFixture({ projects: true });
  try {
    assert.deepEqual(await linearTeams(f.engine, f.connection.id), f.linear.teams);
    const state = await publishLinearTickets(f.engine, f.project.id, input(f));
    assert.equal(state.linearProject?.state, 'linked');
    assert.equal(state.linearProject?.name, 'Deliver books');
    assert.equal(state.linearProject?.id, 'project-1');
    assert.equal(state.records.length, 2);
    assert.ok(state.records.every((record) => record.state === 'synced'));
    assert.ok(
      [...f.issues.values()].every(
        (issue) => issue.team === 'team-books' && issue.project === 'project-1',
      ),
    );
    await publishLinearTickets(f.engine, f.project.id, input(f));
    assert.equal(f.linear.projects.size, 1);
    assert.equal(f.issues.size, 2);
    // Same scope and display name is still a distinct project, not evidence to reuse another destination.
    const other = { ...f.project, id: 'other-project' };
    await atomic(path.join(f.store.project(other.id), 'project.json'), other);
    await commitBaseline(f.store, other.id, f.product, other.context);
    await publishLinearTickets(f.engine, other.id, input(f));
    assert.equal(f.linear.projects.size, 2);
    assert.equal(f.issues.size, 4);
    await assert.rejects(
      saveTicketSettings(f.engine, f.project.id, {
        ...state.settings!,
        destination: { ...state.settings!.destination, project: 'other-project' },
      }),
      /destination/,
    );
  } finally {
    await f.close();
  }
});

void test('lost creation replies reconcile the durable project marker without another create', async () => {
  const f = await ticketFixture({ projects: true });
  try {
    f.linear.behavior.failAfterCreate = true;
    await assert.rejects(publishLinearTickets(f.engine, f.project.id, input(f)));
    assert.equal((await readTicketState(f.store, f.project.id)).linearProject?.state, 'pending');
    assert.equal(f.issues.size, 0);
    f.linear.behavior.missingSearch = true;
    await assert.rejects(
      publishLinearTickets(f.engine, f.project.id, input(f)),
      /still unconfirmed/,
    );
    assert.equal(f.linear.projects.size, 1);
    await assert.rejects(
      publishLinearTickets(f.engine, f.project.id, { ...input(f), teamId: 'team-web' }),
      /original destination/,
    );
    f.linear.behavior.missingSearch = false;
    const state = await publishLinearTickets(f.engine, f.project.id, input(f));
    assert.equal(state.linearProject?.state, 'linked');
    assert.equal(f.linear.calls.filter((call) => call === 'create').length, 1);
    assert.equal(f.issues.size, 2);
  } finally {
    await f.close();
  }
});

void test('known project identity survives read failure; foreign teams and edited markers block tickets', async () => {
  const f = await ticketFixture({ projects: true });
  try {
    f.linear.behavior.failGet = true;
    await assert.rejects(publishLinearTickets(f.engine, f.project.id, input(f)));
    assert.equal((await readTicketState(f.store, f.project.id)).linearProject?.id, 'project-1');
    f.linear.behavior.failGet = false;
    const remote = f.linear.projects.get('project-1')!;
    const description = remote.description;
    remote.description = 'Human replacement';
    await assert.rejects(
      publishLinearTickets(f.engine, f.project.id, input(f)),
      /marker does not match/,
    );
    remote.description = description;
    remote.teams = [{ id: 'team-web' }];
    await assert.rejects(
      publishLinearTickets(f.engine, f.project.id, input(f)),
      /marker does not match/,
    );
    assert.equal(f.issues.size, 0);
    remote.teams = [{ id: 'team-books' }];
    await publishLinearTickets(f.engine, f.project.id, input(f));
    assert.equal(f.linear.projects.size, 1);
    assert.equal(f.issues.size, 2);
  } finally {
    await f.close();
  }
});

void test('unknown teams, changed contracts, incomplete search, and arbitrary writes cannot create projects', async () => {
  const f = await ticketFixture({ projects: true });
  try {
    await assert.rejects(
      publishLinearTickets(f.engine, f.project.id, { ...input(f), teamId: 'unknown-team' }),
      /available Linear team/,
    );
    await assert.rejects(
      publishLinearTickets(f.engine, f.project.id, { ...input(f), fingerprint: '0'.repeat(64) }),
      /contracts changed/,
    );
    await assert.rejects(
      f.engine.integrations.linearOperation(f.connection.id, {
        kind: 'create',
        name: 'Unreviewed',
        description: 'No consent',
        team: 'team-books',
      }),
      /Review publishing settings/,
    );
    await assert.rejects(
      f.engine.integrations.call(f.connection.id, 'save_project', {}),
      /not approved/,
    );
    f.linear.behavior.incomplete = true;
    await assert.rejects(publishLinearTickets(f.engine, f.project.id, input(f)), /incomplete/);
    assert.equal(f.linear.projects.size, 0);
    assert.equal((await readTicketState(f.store, f.project.id)).linearProject, undefined);
    const methods = createMethods(f.engine, {} as RuntimeControls);
    assert.throws(
      () =>
        methods.publishLinearTickets({
          projectId: f.project.id,
          ...input(f),
          name: 'Renderer-controlled name',
        }),
      /Unrecognized key/,
    );
    assert.throws(
      () => methods.linearTeams({ connectionId: f.connection.id, tool: 'delete_project' }),
      /Unrecognized key/,
    );
    await f.engine.integrations.disconnect(f.connection.id);
    await assert.rejects(linearTeams(f.engine, f.connection.id), /Connect Linear/);
  } finally {
    await f.close();
  }
});
