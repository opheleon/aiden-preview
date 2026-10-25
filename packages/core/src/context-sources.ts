import type { Project } from '../../contracts/src/index.js';
import type { McpConnection } from '../../contracts/src/integrations.js';
import { notionContext, notionLinks } from '../../contracts/src/tracker-connections.js';
import type { WorkflowContext } from './workflow-context.js';

/** One project-selected connection the model can read through external_read. */
export interface ContextSource {
  connectionId: string;
  name: string;
  /** Approved read tools with their argument schemas, so the model can call them correctly. */
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

/** A selected connection the model cannot read right now, with what the person can do about it. */
export interface UnavailableSource {
  name: string;
  reason: string;
}

/**
 * The project's selected context connections with their approved read tools, for a stage that
 * offers external_read. A connection that cannot be read right now is listed in `unavailable`
 * with a plain reason rather than failing the run, so the stage can say exactly what to fix.
 * Example: Notion whose server changed its tools has no approved read tools, so it is unavailable
 * with "Its tools changed. Review its read tools in Settings, Integrations." rather than missing.
 */
export async function contextSources(
  context: Pick<WorkflowContext, 'integrations'>,
  project: Project,
): Promise<{ sources: ContextSource[]; unavailable: UnavailableSource[] }> {
  const sources: ContextSource[] = [];
  const unavailable: UnavailableSource[] = [];
  for (const connectionId of project.sources?.contextConnectionIds ?? []) {
    let name = 'A selected connection';
    try {
      const connection = await context.integrations.get(connectionId);
      name = connection.name;
      const tools = await context.integrations.refreshTools(connection);
      const readable = tools.filter((tool) => tool.approved && tool.readOnly);
      if (readable.length)
        sources.push({
          connectionId,
          name,
          tools: readable.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      else unavailable.push({ name, reason: unreadableReason(connection.status) });
    } catch {
      // An unreachable or signed-out connection never blocks writing the requirements.
      unavailable.push({
        name,
        reason: `Aiden could not reach ${name}. Use Connect / test in Settings, Integrations.`,
      });
    }
  }
  return { sources, unavailable };
}

/** Why a reachable connection offers no read tools, in words that name the fix. */
function unreadableReason(status: string): string {
  return status === 'needs_review'
    ? 'Its tools changed. Review its read tools in Settings, Integrations.'
    : 'No read tools are approved. Choose its read tools in Settings, Integrations.';
}

/**
 * Select the Notion connection for a project whose goal links Notion pages, so the pages can be
 * read without a separate settings step. Pasting a link is the person's choice to use it.
 * Example: a goal with a notion.so link and a saved Notion connection gains that connection.
 */
export function withLinkedSources(project: Project, connections: McpConnection[]): Project {
  if (!notionLinks(project.context).length) return project;
  const notion = connections.find(notionContext);
  const selected = project.sources?.contextConnectionIds ?? [];
  if (!notion || selected.includes(notion.id)) return project;
  return {
    ...project,
    sources: {
      history: project.sources?.history ?? null,
      contextConnectionIds: [...selected, notion.id],
    },
  };
}
