import type {
  RemoteTicket,
  TicketRecord,
  TicketSettings,
  TicketState,
} from '../../contracts/src/tickets.js';
import {
  createdTicketId,
  remoteTicket,
  searchedTicketIds,
  ticketText,
} from '../../integrations/src/ticket-results.js';
import type { DeliveryTicket } from '../../reporting/src/tickets.js';
import type { Engine } from './engine.js';
import { hash } from './storage.js';
import { writeTicketState } from './ticket-storage.js';

/** Hash only fields managed by Aiden; remote workflow status and assignees remain human-owned. */
function contentHash(title: string, description: string): string {
  return hash([ticketText(title), ticketText(description)]);
}
/** Retain current tracker observations without equating workflow state with tested completion. */
function observe(record: TicketRecord, issue: RemoteTicket): void {
  record.issueId = issue.id;
  record.checkedAt = new Date().toISOString();
  record.observedHash = contentHash(issue.title, issue.description);
  if (issue.url) record.url = issue.url;
  record.remoteStatus = issue.status ?? 'Not supplied';
  if (issue.statusType) record.remoteStatusType = issue.statusType;
  record.assignee = issue.assignee ?? 'Unassigned';
}
/** Get an issue and independently verify that it still belongs to this feature and destination. */
async function getIssue(
  engine: Engine,
  settings: TicketSettings,
  record: TicketRecord,
): Promise<RemoteTicket> {
  const result = await engine.integrations.ticketOperation(settings, 'get', {
    id: record.issueId!,
  });
  const issue = remoteTicket(result, settings.destination);
  if (!issue.description.includes(record.marker))
    throw new Error(
      'Ticket identity marker is missing. Resolve the tracker conflict before Aiden updates it.',
    );
  observe(record, issue);
  return issue;
}
/** Search results can omit scope and body; fetch candidates before matching a recovery marker. */
async function recoverIssue(
  engine: Engine,
  settings: TicketSettings,
  marker: string,
): Promise<RemoteTicket | null> {
  const candidates = searchedTicketIds(
    await engine.integrations.ticketOperation(settings, 'search', { marker }),
  );
  const matches: RemoteTicket[] = [];
  for (const id of candidates) {
    const issue = remoteTicket(
      await engine.integrations.ticketOperation(settings, 'get', { id }),
      settings.destination,
    );
    if (issue.description.includes(marker)) matches.push(issue);
  }
  if (matches.length > 1)
    throw new Error(
      'Multiple tickets contain this recovery marker. Resolve duplicates in the tracker.',
    );
  return matches[0] ?? null;
}
/** Reconcile one managed feature, persisting write intent before invoking a remote mutation. */
export async function reconcileTicket(
  engine: Engine,
  projectId: string,
  state: TicketState,
  record: TicketRecord,
  ticket: DeliveryTicket,
): Promise<void> {
  const settings = state.settings!;
  const title = `${ticket.blocked ? '[Blocked] ' : ''}${ticket.title}`;
  const description = `${ticket.markdown}\n\nAiden identity: ${record.marker}`;
  const desiredHash = contentHash(title, description);
  record.title = title;
  if (!record.issueId) {
    const found = await recoverIssue(engine, settings, record.marker);
    if (found) observe(record, found);
    else if (record.state === 'uncertain' || record.pendingHash) {
      record.state = 'uncertain';
      record.message =
        'A previous creation may have succeeded. Aiden is searching for its identity marker and will not create a duplicate.';
      return;
    } else {
      record.pendingHash = desiredHash;
      record.state = 'uncertain';
      await writeTicketState(engine.store, projectId, state);
      const created = await engine.integrations.ticketOperation(settings, 'create', {
        title,
        description,
      });
      record.issueId = createdTicketId(created);
      await writeTicketState(engine.store, projectId, state);
    }
  }
  let issue = await getIssue(engine, settings, record);
  let currentHash = contentHash(issue.title, issue.description);
  if (currentHash === record.pendingHash) {
    record.contentHash = currentHash;
    delete record.pendingHash;
  }
  if (currentHash !== desiredHash) {
    if (!record.contentHash || currentHash !== record.contentHash) {
      record.state = 'conflict';
      record.message =
        'Ticket content differs from the last verified version. Review human edits in the tracker; Aiden has not overwritten them.';
      return;
    }
    record.pendingHash = desiredHash;
    await writeTicketState(engine.store, projectId, state);
    await engine.integrations.ticketOperation(settings, 'update', {
      id: record.issueId!,
      title,
      description,
    });
    issue = await getIssue(engine, settings, record);
    currentHash = contentHash(issue.title, issue.description);
  }
  if (currentHash !== desiredHash) {
    record.state = 'conflict';
    record.message =
      'The tracker did not save the expected ticket content. Read-back verification failed.';
    return;
  }
  record.contentHash = desiredHash;
  delete record.pendingHash;
  record.state = 'synced';
  record.message = ticket.blocked
    ? 'Published as blocked draft scope. Resolve decisions before implementation.'
    : 'Ticket content read back and verified. Tracker status is not acceptance evidence.';
}
