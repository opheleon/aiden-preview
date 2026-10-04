import assert from 'node:assert/strict';
import test from 'node:test';

import type { TicketSettings } from '../packages/contracts/src/tickets.js';
import { assessTool } from '../packages/integrations/src/index.js';
import {
  remoteTicket,
  searchedTicketIds,
  ticketPayload,
  ticketText,
} from '../packages/integrations/src/ticket-results.js';
import {
  ticketArguments,
  ticketTools,
  validateTicketArguments,
} from '../packages/integrations/src/ticket-tools.js';

const jira: TicketSettings = {
  enabled: true,
  destination: {
    provider: 'jira',
    connectionId: 'jira',
    cloudId: 'https://books.atlassian.net',
    projectKey: 'BOOK',
    issueTypeName: 'Task',
  },
  fingerprint: 'a'.repeat(64),
  tools: {
    create: 'createJiraIssue',
    update: 'editJiraIssue',
    get: 'getJiraIssue',
    search: 'searchJiraIssuesUsingJql',
  },
};
void test('Jira adapter confines content writes, normalizes documents and observes human workflow', () => {
  const description =
    '# Feature\n\n- Acceptance criterion\nAiden identity: aiden-ticket-' + 'b'.repeat(32);
  const create = ticketArguments(jira, 'create', { title: 'Feature', description });
  assert.deepEqual(create, {
    cloudId: jira.destination.provider === 'jira' ? jira.destination.cloudId : '',
    projectKey: 'BOOK',
    issueTypeName: 'Task',
    summary: 'Feature',
    description,
  });
  const update = ticketArguments(jira, 'update', { id: 'BOOK-1', title: 'Feature', description });
  const fields = update.fields as { summary: string; description: unknown };
  assert.deepEqual(Object.keys(fields), ['summary', 'description']);
  const normalized = remoteTicket(
    {
      key: 'BOOK-1',
      self: 'https://books.atlassian.net/rest/api/3/issue/123',
      fields: {
        ...fields,
        project: { key: 'BOOK', name: 'Books' },
        status: { name: 'Done' },
        assignee: { displayName: 'Alex' },
      },
    },
    jira.destination,
  );
  assert.equal(ticketText(normalized.description), ticketText(description));
  assert.equal(normalized.status, 'Done');
  assert.equal(normalized.assignee, 'Alex');
  assert.equal(normalized.url, 'https://books.atlassian.net/browse/BOOK-1');
  assert.throws(
    () => ticketArguments(jira, 'search', { marker: '" OR project = PRIVATE' }),
    /marker/,
  );
  assert.throws(
    () =>
      remoteTicket(
        { key: 'BOOK-1', fields: { summary: 'Feature', description, project: { key: 'PRIVATE' } } },
        jira.destination,
      ),
    /outside/,
  );
});
void test('search and result adapters refuse ambiguous pagination, unknown shapes, and raw server errors', () => {
  assert.deepEqual(searchedTicketIds({ issues: [{ key: 'BOOK-1' }] }), ['BOOK-1']);
  assert.throws(() => searchedTicketIds({ issues: [], total: 3 }), /incomplete/);
  assert.throws(() => searchedTicketIds({ issues: [], nextPageToken: 'next' }), /incomplete/);
  assert.throws(() => searchedTicketIds({ issues: [{}] }), /identity/);
  assert.throws(
    () => ticketPayload({ content: [{ type: 'text', text: 'Created successfully' }] }),
    /JSON/,
  );
  assert.throws(
    () =>
      ticketPayload({ isError: true, content: [{ type: 'text', text: 'secret-provider-text' }] }),
    (e: Error) => !e.message.includes('secret-provider-text'),
  );
  assert.deepEqual(ticketPayload({ structuredContent: { id: 'one' } }), { id: 'one' });
});
void test('supported tools need complete reviewed contracts and cannot masquerade as analyst reads', () => {
  for (const name of ['save_issue', 'createJiraIssue', 'editJiraIssue'])
    assert.equal(assessTool({ name, annotations: { readOnlyHint: true } }, [name]).approved, false);
  assert.throws(() => ticketTools('jira', []), /lacks/);
  const tool = assessTool({
    name: 'createJiraIssue',
    inputSchema: {
      type: 'object',
      properties: { cloudId: { type: 'string' }, priority: { type: 'string' } },
      required: ['cloudId', 'priority'],
    },
  });
  assert.throws(() => validateTicketArguments(tool, { cloudId: 'site' }), /additional fields/);
  assert.throws(
    () => validateTicketArguments(tool, { cloudId: 12, priority: 'high' }),
    /unsupported type/,
  );
  assert.throws(
    () => validateTicketArguments(tool, { cloudId: 'site', priority: 'high', delete: true }),
    /expected delete/,
  );
});

void test('tracker errors identify the failed operation and recovery without exposing provider text', () => {
  for (const [text, message] of [
    ['Validation failed: limit maximum 50', /rejected the request parameters/],
    ['Unauthorized token expired', /session has expired/],
    ['Forbidden: permission denied', /lacks access/],
    ['Project not found', /unavailable/],
    ['Rate limit exceeded', /rate limiting/],
    ['unknown failure', /service status/],
  ] as const) {
    assert.throws(
      () =>
        ticketPayload(
          { isError: true, content: [{ text: `${text} SECRET_VALUE` }] },
          'Ticket create',
        ),
      (error: Error) => {
        assert.match(error.message, /^Ticket create failed/);
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /SECRET_VALUE/);
        return true;
      },
    );
  }
  const tool = assessTool({
    name: 'list_projects',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 50 } },
    },
  });
  assert.throws(() => validateTicketArguments(tool, { limit: 100 }), /supported range/);
  assert.throws(() => validateTicketArguments(tool, { limit: 0 }), /supported range/);
  validateTicketArguments(tool, { limit: 50 });
});

void test('flat Linear issue UUID fields verify the project while preserving Done and completed observations', () => {
  const destination = {
    provider: 'linear' as const,
    connectionId: 'linear',
    team: 'team-uuid',
    project: 'project-uuid',
  };
  const raw = {
    id: 'TEST-11',
    uuid: 'issue-uuid',
    title: 'Synthetic issue',
    description: 'Managed scope',
    project: 'Synthetic project',
    projectId: 'project-uuid',
    team: 'Test',
    teamId: 'team-uuid',
    status: 'Done',
    statusType: 'completed',
  };
  const result = remoteTicket(raw, destination);
  assert.equal(result.status, 'Done');
  assert.equal(result.statusType, 'completed');
  assert.throws(() => remoteTicket({ ...raw, projectId: 'foreign-uuid' }, destination), /outside/);
});
