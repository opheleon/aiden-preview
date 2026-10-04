import type { McpConnection } from './integrations.js';

/** Supported presets remain distinct from legacy read-only endpoints and custom accounts. */
export function trackerUrl(provider: 'linear' | 'jira'): string {
  return provider === 'linear'
    ? 'https://mcp.linear.app/mcp'
    : 'https://mcp.atlassian.com/v2/mcp?tools=all';
}
/** Recognize the old Linear read-only catalog without merging credentials or changing permissions. */
export function readOnlyLinear(connection: McpConnection): boolean {
  return connection.url.replace(/\/$/, '') === 'https://mcp.linear.app/mcp/readonly';
}
/** Prefer a ready preset; otherwise reuse the most recently saved matching OAuth connection. */
export function trackerConnection(
  connections: McpConnection[],
  provider: 'linear' | 'jira',
): McpConnection | undefined {
  return connections
    .filter((c) => c.auth === 'oauth' && c.url.replace(/\/$/, '') === trackerUrl(provider))
    .sort(
      (a, b) =>
        Number(b.status === 'connected') - Number(a.status === 'connected') ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
}
/** Name a connection with its readiness so identical provider names are never ambiguous. */
export function trackerLabel(connection: McpConnection): string {
  const status =
    connection.status === 'connected' || connection.status === 'needs_review'
      ? 'Connected'
      : connection.status === 'authorization_required'
        ? 'Finish sign-in'
        : 'Reconnect required';
  return `${connection.name} · ${readOnlyLinear(connection) ? 'Read-only' : status}`;
}
