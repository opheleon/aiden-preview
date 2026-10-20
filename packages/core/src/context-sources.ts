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

/**
 * The project's selected context connections with their approved read tools, for a stage that
 * offers external_read. A connection that cannot be reached right now is left out rather than
 * failing the run; the stage then works from the pasted text alone.
 */
export async function contextSources(
  context: Pick<WorkflowContext, 'integrations'>,
  project: Project,
): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  for (const connectionId of project.sources?.contextConnectionIds ?? []) {
    try {
      const connection = await context.integrations.get(connectionId);
      const tools = await context.integrations.refreshTools(connection);
      const readable = tools.filter((tool) => tool.approved && tool.readOnly);
      if (readable.length)
        sources.push({
          connectionId,
          name: connection.name,
          tools: readable.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
    } catch {
      // An unreachable or signed-out connection never blocks writing the requirements.
    }
  }
  return sources;
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
