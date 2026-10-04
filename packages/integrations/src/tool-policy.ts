import { type McpTool } from '../../contracts/src/index.js';
import { hash } from '../../core/src/storage.js';
const WRITE_PATTERN =
  /(^|[_\-.])(create|update|delete|remove|write|set|save|add|edit|move|archive|restore|comment|assign|upload|send|publish)([_\-.]|$)/i;
const READ_PATTERN = /(^|[_\-.])(get|list|search|find|read|lookup|query|fetch|view)([_\-.]|$)/i;

/** Classify tool metadata conservatively; write hints override read claims and approval. */
export function assessTool(
  tool: {
    name: string;
    description?: string | undefined;
    inputSchema?: Record<string, unknown>;
    annotations?:
      { readOnlyHint?: boolean | undefined; destructiveHint?: boolean | undefined } | undefined;
  },
  approved: string[] = [],
): McpTool {
  const writeLike =
    WRITE_PATTERN.test(tool.name.replace(/([a-z])([A-Z])/g, '$1_$2')) ||
    tool.annotations?.destructiveHint === true;
  const declaredRead = tool.annotations?.readOnlyHint === true;
  const recognizedRead = READ_PATTERN.test(tool.name);
  const readOnly = !writeLike && (declaredRead || recognizedRead);
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? { type: 'object' },
    readOnly,
    approved: readOnly && approved.includes(tool.name),
    reason: writeLike
      ? 'The tool appears to change external data.'
      : readOnly
        ? 'Recognized as a read operation; project approval is still required.'
        : 'The server did not identify this as a known read operation.',
  };
}
/** Hash sorted tool contracts so server definition changes invalidate prior consent. */
export function toolFingerprint(tools: McpTool[]): string {
  return hash(
    tools
      .map(({ name, description, inputSchema, readOnly }) => ({
        name,
        description,
        inputSchema,
        readOnly,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}
