import type { McpTool } from '../../contracts/src/index.js';
import { validateTicketArguments } from './ticket-tools.js';

/** Only these bounded setup operations can reach Linear project capabilities. */
export type LinearOperation =
  | { kind: 'teams'; cursor?: string }
  | { kind: 'search'; team: string; name: string }
  | { kind: 'get'; id: string }
  | { kind: 'create'; team: string; name: string; description: string };
/** A listed team is presentation-safe metadata, never an instruction. */
export interface LinearTeam {
  id: string;
  name: string;
}
/** Verified project identity and content returned by a project read. */
export interface LinearProject {
  id: string;
  identifier?: string;
  name: string;
  description: string;
  teams: string[];
  url?: string;
}

/** Build arguments from current supported contracts, never accepting an arbitrary tool name or write. */
export function linearOperation(
  tools: McpTool[],
  input: LinearOperation,
): { name: string; args: Record<string, unknown> } {
  const names = {
    teams: ['list_teams'],
    search: ['list_projects'],
    get: ['get_project'],
    create: ['save_project', 'create_project'],
  };
  const tool = tools.find((t) => names[input.kind].includes(t.name));
  if (!tool)
    throw new Error(
      `This connection lacks a supported Linear ${input.kind} tool. Reconnect with project permissions.`,
    );
  const fields = object(tool.inputSchema.properties);
  const args = linearArguments(fields, input);
  validateTicketArguments(tool, args);
  return { name: tool.name, args };
}

/** Support known Linear field variants while failing closed on unknown required fields. */
function linearArguments(
  fields: Record<string, unknown>,
  input: LinearOperation,
): Record<string, unknown> {
  if (input.kind === 'teams')
    return {
      ...(fields.limit ? { limit: 100 } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    };
  if (input.kind === 'search')
    return { query: input.name, team: input.team, ...(fields.limit ? { limit: 50 } : {}) };
  if (input.kind === 'get') return fields.query ? { query: input.id } : { id: input.id };
  const teamField = fields.setTeams
    ? { setTeams: [input.team] }
    : fields.teams
      ? { teams: [input.team] }
      : { team: input.team };
  return { name: input.name, description: input.description, ...teamField };
}

/** Ignore prototype and non-object payloads when interpreting external JSON. */
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Validate list shapes and pagination before allowing discovery or project creation. */
export function linearPage(
  payload: unknown,
  key: 'teams' | 'projects',
): { rows: unknown[]; cursor?: string } {
  const data = object(payload);
  const rows = Array.isArray(payload) ? payload : data[key];
  if (!Array.isArray(rows)) throw new Error(`Linear returned an unsupported ${key} list.`);
  const page = object(data.pageInfo);
  const more = data.hasNextPage === true || page.hasNextPage === true || !!data.nextCursor;
  const cursor = data.nextCursor ?? page.endCursor ?? data.cursor;
  if (more && typeof cursor === 'string' && cursor) return { rows, cursor };
  if (more || incompletePage(data, page, rows.length, key === 'projects' ? 50 : 100))
    throw new Error(`Linear ${key} discovery is incomplete. Retry before publishing.`);
  return { rows };
}

/** Return only stable team IDs and display names from an authenticated team listing. */
export function linearTeam(value: unknown): LinearTeam {
  const row = object(value);
  if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name)
    throw new Error('Linear returned an incomplete team.');
  return { id: row.id, name: row.name };
}

/** Extract creation or search identity without treating it as read-back verification. */
export function linearProjectId(value: unknown): string {
  const outer = object(value);
  const row = object(outer.project ?? value);
  const id = row.uuid ?? row.id;
  if (typeof id !== 'string' || !id)
    throw new Error('Linear returned no project identity. Retry to reconcile the pending project.');
  return id;
}

/** Require team membership and managed description before linking an automatically created project. */
export function linearProject(value: unknown): LinearProject {
  const outer = object(value);
  const row = object(outer.project ?? value);
  const teamRows = Array.isArray(row.teams) ? row.teams : object(row.teams).nodes;
  if (
    typeof row.name !== 'string' ||
    typeof row.description !== 'string' ||
    !Array.isArray(teamRows)
  )
    throw new Error('Linear project name, description, or team membership could not be verified.');
  const teams = teamRows.map((t: unknown) => (typeof t === 'string' ? t : object(t).id));
  if (teams.some((id) => typeof id !== 'string' || !id))
    throw new Error('Linear project team membership could not be verified.');
  return {
    id: linearProjectId(row),
    ...(typeof row.id === 'string' && row.id !== linearProjectId(row)
      ? { identifier: row.id }
      : {}),
    name: row.name,
    description: row.description,
    teams: teams as string[],
    ...(typeof row.url === 'string' && /^https:\/\//.test(row.url) ? { url: row.url } : {}),
  };
}

/** A truncated or full unmarked page cannot authorize absence-based project creation. */
function incompletePage(
  data: Record<string, unknown>,
  page: Record<string, unknown>,
  count: number,
  limit: number,
): boolean {
  return (
    !!data.nextPageToken ||
    (typeof data.total === 'number' && data.total > count) ||
    (count >= limit && data.hasNextPage !== false && page.hasNextPage !== false)
  );
}
