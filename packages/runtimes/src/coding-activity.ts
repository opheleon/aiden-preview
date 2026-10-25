import type { ExecutionActivity } from '../../contracts/src/accounts-execution.js';

/** Read only known event shapes; provider text stays out of telemetry and logs. */
export function codingActivity(message: unknown): ExecutionActivity[] {
  if (!message || typeof message !== 'object') return [];
  const event = message as Record<string, unknown>;
  if (event.type !== 'assistant' && event.type !== 'user') return [];
  const payload = event.message as { content?: unknown } | undefined;
  if (!Array.isArray(payload?.content)) return [];
  return payload.content.flatMap((item: unknown): ExecutionActivity[] => {
    if (!item || typeof item !== 'object') return [];
    const block = item as Record<string, unknown>;
    if (block.type === 'tool_use' && typeof block.id === 'string') {
      if (typeof block.name === 'string' && block.name.startsWith('mcp__aiden_status__')) return [];
      return [{ type: 'tool-start', id: block.id }];
    }
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string')
      return [{ type: 'tool-end', id: block.tool_use_id }];
    return block.type === 'text' ? [{ type: 'output' }] : [];
  });
}
