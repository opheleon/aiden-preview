import type { RemoteTicket, TicketDestination } from '../../contracts/src/tickets.js';

/** Interpret JSON MCP output without treating remote text as instructions. */
export function ticketPayload(result: unknown, operation = 'Tracker operation'): unknown {
  const value = object(result);
  if (value.isError === true) throw new Error(`${operation} failed. ${trackerFailure(value)}`);
  if (value.structuredContent) return value.structuredContent;
  const content = Array.isArray(value.content) ? value.content : [];
  for (const block of content) {
    const text = object(block).text;
    if (typeof text === 'string') {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        /* Only structured JSON is accepted. */
      }
    }
  }
  throw new Error('The tracker did not return a supported JSON result.');
}
/** Classify remote failures into fixed copy; raw provider output may contain credentials or private data. */
function trackerFailure(value: Record<string, unknown>): string {
  const text = JSON.stringify(value).slice(0, 100_000).toLowerCase();
  if (
    /invalid.grant|unauthenticated|unauthorized|token.{0,30}expir|authentication required/.test(
      text,
    )
  )
    return 'The tracker session has expired. Reconnect the existing connection and retry.';
  if (/validation|invalid.{0,20}(argument|parameter|input)|maximum|minimum|too_big/.test(text))
    return 'The tracker rejected the request parameters. Review the publishing setup or update Aiden; reconnecting will not fix this request.';
  if (/forbidden|permission|access denied|not authorized|insufficient.scope/.test(text))
    return 'This account lacks access to the selected destination or operation. Check team and project permissions.';
  if (/not found|could not find|does not exist/.test(text))
    return 'The selected team, project, or ticket is unavailable. Check the destination and account access.';
  if (/rate.limit|too many requests/.test(text))
    return 'The tracker is rate limiting requests. Wait briefly before syncing again.';
  return 'The tracker returned an error. Retry syncing; if it continues, check the destination and tracker service status.';
}
/** Read object fields safely from unknown provider data. */
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Provider identities may be IDs, names, keys, or small nested objects. */
function label(value: unknown): string {
  if (typeof value === 'string') return value;
  const row = object(value);
  return (
    [row.name, row.key, row.id, row.displayName].find((v): v is string => typeof v === 'string') ??
    ''
  );
}
/** Flatten Jira document text for deterministic read-back comparison. */
function documentText(value: unknown): string {
  if (typeof value === 'string') return value;
  const row = object(value);
  if (typeof row.text === 'string') return row.text;
  return Array.isArray(row.content)
    ? row.content.map(documentText).join(row.type === 'paragraph' ? '' : '\n')
    : '';
}
/** Normalize a fetched issue; missing identity, scope, or content fails closed. */
export function remoteTicket(payload: unknown, destination: TicketDestination): RemoteTicket {
  const outer = object(payload);
  const row = object(outer.issue ?? payload);
  const fields = destination.provider === 'jira' ? object(row.fields) : row;
  const id = destination.provider === 'jira' ? (row.key ?? row.id) : row.id;
  const title = fields.title ?? fields.summary;
  const description = documentText(fields.description);
  if (typeof id !== 'string' || typeof title !== 'string' || !description)
    throw new Error(
      'The tracker returned an incomplete ticket. Read-back verification is pending.',
    );
  const { project, team } = checkScope(fields, destination);
  return { id, title, description, project, ...ticketMetadata(row, fields, destination, id, team) };
}
/** Validate the remote issue against the selected project and team. */
function checkScope(
  fields: Record<string, unknown>,
  destination: TicketDestination,
): { project: string; team: string } {
  const project = label(fields.project);
  const team = label(fields.team);
  const projectIds = [
    project,
    object(fields.project).id,
    object(fields.project).key,
    object(fields.project).name,
    fields.projectId,
  ];
  const expected = destination.provider === 'linear' ? destination.project : destination.projectKey;
  if (!projectIds.includes(expected))
    throw new Error(
      'The ticket is outside the configured project, or its project could not be verified.',
    );
  if (
    destination.provider === 'linear' &&
    ![team, object(fields.team).id, object(fields.team).key, fields.teamId].includes(
      destination.team,
    )
  )
    throw new Error('The ticket team does not match the configured destination.');
  return { project, team };
}
/** Extract workflow observations and a safe link without trusting them as acceptance evidence. */
function ticketMetadata(
  row: Record<string, unknown>,
  fields: Record<string, unknown>,
  destination: TicketDestination,
  id: string,
  team: string,
): Partial<RemoteTicket> {
  let url = row.url ?? row.webUrl;
  if (
    !url &&
    destination.provider === 'jira' &&
    typeof row.self === 'string' &&
    /^https:\/\//.test(row.self)
  )
    url = new URL(`/browse/${encodeURIComponent(id)}`, row.self).href;
  return {
    ...(team ? { team } : {}),
    ...(typeof url === 'string' && /^https:\/\//.test(url) ? { url } : {}),
    ...(label(fields.status) ? { status: label(fields.status) } : {}),
    ...(typeof fields.statusType === 'string' ? { statusType: fields.statusType } : {}),
    ...(label(fields.assignee) ? { assignee: label(fields.assignee) } : {}),
  };
}
/** Extract the new issue identity without trusting creation as proof of its content. */
export function createdTicketId(payload: unknown): string {
  const outer = object(payload);
  const row = object(outer.issue ?? payload);
  const id = row.key ?? row.id;
  if (typeof id !== 'string' || !id)
    throw new Error(
      'Creation returned no issue identity. Reconciliation will search for its recovery marker.',
    );
  return id;
}
/** Read every candidate identity for an independent GET; incomplete searches cannot authorize creation. */
export function searchedTicketIds(payload: unknown): string[] {
  const data = object(payload);
  const rows = Array.isArray(payload) ? payload : (data.issues ?? data.results);
  if (!Array.isArray(rows)) throw new Error('Issue search returned an unsupported result.');
  if (
    data.hasNextPage === true ||
    object(data.pageInfo).hasNextPage === true ||
    data.nextPageToken ||
    (typeof data.total === 'number' && data.total > rows.length) ||
    rows.length >= 50
  )
    throw new Error(
      'Issue search is incomplete. Narrow the tracker destination before publishing.',
    );
  return [...new Set(rows.map(createdTicketId))];
}
/** Normalize tracker formatting; rich issue mentions collapse only for already verified ticket IDs and URLs. */
export function ticketText(
  value: string,
  knownTickets: readonly { issueId?: string | undefined; url?: string | undefined }[] = [],
): string {
  return value
    .replace(
      /<issue id="[a-f0-9-]{36}" href="([^"]+)">([^<>]+)<\/issue>/g,
      (original: string, url: string, id: string) =>
        knownTickets.some((ticket) => ticket.issueId === id && ticket.url === url) ? id : original,
    )
    .replace(/\[(https:\/\/[^\]\s]+)\]\(<?\1>?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
