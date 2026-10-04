import type { McpTool } from '../../contracts/src/index.js';
import type {
  TicketDestination,
  TicketSettings,
  TicketTools,
} from '../../contracts/src/tickets.js';

/** Data authored by the trusted ticket reconciler; not general-purpose tool arguments. */
export interface TicketOperationInput {
  id?: string;
  title?: string;
  description?: string;
  marker?: string;
}
/** Discover only supported issue capabilities, requiring their input contracts before granting consent. */
export function ticketTools(
  provider: TicketDestination['provider'],
  tools: McpTool[],
): TicketTools {
  const names =
    provider === 'linear'
      ? {
          create: ['save_issue', 'create_issue'],
          update: ['save_issue', 'update_issue'],
          get: ['get_issue'],
          search: ['list_issues'],
        }
      : {
          create: ['createJiraIssue'],
          update: ['editJiraIssue'],
          get: ['getJiraIssue'],
          search: ['searchJiraIssuesUsingJql'],
        };
  const result = {} as TicketTools;
  for (const operation of ['create', 'update', 'get', 'search'] as const) {
    const tool = tools.find((t) => names[operation].includes(t.name));
    if (!tool)
      throw new Error(
        `This connection lacks a supported ${operation} issue tool. Connect a read/write MCP server with issue permissions.`,
      );
    result[operation] = tool.name;
  }
  return result;
}

/** Build bounded issue operations from the saved destination, excluding assignment, deletion, and transitions. */
export function ticketArguments(
  settings: TicketSettings,
  operation: keyof TicketTools,
  input: TicketOperationInput,
): Record<string, unknown> {
  const d = settings.destination;
  if (operation === 'get' || operation === 'update') {
    if (!input.id) throw new Error('An existing ticket identity is required.');
  }
  if (operation === 'create' || operation === 'update') {
    if (!input.title || !input.description)
      throw new Error('Ticket title and description are required.');
  }
  if (operation === 'search' && !/^aiden-ticket-[a-f0-9]{32}$/.test(input.marker ?? ''))
    throw new Error('A valid recovery marker is required.');
  return d.provider === 'linear'
    ? linearArguments(d, operation, input)
    : jiraArguments(d, operation, input);
}

/** Build issue content and reads scoped to a Linear team and project. */
function linearArguments(
  d: Extract<TicketDestination, { provider: 'linear' }>,
  operation: keyof TicketTools,
  input: TicketOperationInput,
): Record<string, unknown> {
  if (operation === 'get') return { id: input.id };
  if (operation === 'search')
    return { query: input.marker, team: d.team, project: d.project, limit: 50 };
  const content = { title: input.title, description: input.description };
  return operation === 'create'
    ? { ...content, team: d.team, project: d.project }
    : { ...content, id: input.id };
}

/** Build Jira operations scoped to a site and project, preserving human workflow fields. */
function jiraArguments(
  d: Extract<TicketDestination, { provider: 'jira' }>,
  operation: keyof TicketTools,
  input: TicketOperationInput,
): Record<string, unknown> {
  const site = { cloudId: d.cloudId };
  if (operation === 'get') return { ...site, issueIdOrKey: input.id };
  if (operation === 'search')
    return {
      ...site,
      jql: `project = "${d.projectKey}" AND text ~ "${input.marker}"`,
      maxResults: 50,
      fields: ['summary', 'description', 'status', 'assignee', 'project'],
    };
  if (operation === 'create')
    return {
      ...site,
      projectKey: d.projectKey,
      issueTypeName: d.issueTypeName,
      summary: input.title,
      description: input.description,
    };
  return {
    ...site,
    issueIdOrKey: input.id,
    fields: {
      summary: input.title,
      description: {
        version: 1,
        type: 'doc',
        content: input
          .description!.split('\n')
          .filter(Boolean)
          .map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
      },
    },
  };
}

/** Refuse unsupported required arguments or changed field types before making any remote call. */
export function validateTicketArguments(tool: McpTool, args: Record<string, unknown>): void {
  const schema = tool.inputSchema;
  const properties = schema.properties as
    Record<string, { type?: unknown; minimum?: number; maximum?: number }> | undefined;
  if (!properties || schema.type !== 'object')
    throw new Error(`Unsupported input contract for ${tool.name}.`);
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((key) => typeof key !== 'string' || !(key in args)))
    throw new Error(
      `${tool.name} requires additional fields. This server contract is not supported yet.`,
    );
  for (const [key, value] of Object.entries(args)) {
    const field = properties[key];
    if (!field) throw new Error(`${tool.name} does not support the expected ${key} field.`);
    if (outsideBounds(value, field))
      throw new Error(`${tool.name}.${key} is outside the server's supported range.`);
    if (field.type && typeof field.type === 'string') {
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (field.type !== actual) throw new Error(`${tool.name}.${key} has an unsupported type.`);
    }
  }
}

/** Enforce advertised numeric limits before a request can reach the tracker. */
function outsideBounds(value: unknown, field: { minimum?: number; maximum?: number }): boolean {
  return (
    typeof value === 'number' &&
    (value < (field.minimum ?? -Infinity) || value > (field.maximum ?? Infinity))
  );
}
