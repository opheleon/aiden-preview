import type { McpConnection } from './integrations.js';

/** One-click hosted connections. Notion is read-only project context and never a ticket tracker. */
export type IntegrationPreset = 'linear' | 'jira' | 'notion';

/** Hosted Notion MCP endpoint, used only through read tools the user approves. */
export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
/**
 * The read-only Notion tools Aiden uses to read linked pages: fetch a page by link, and search when
 * a page links to others by title. They come pre-ticked for approval; nothing else does.
 */
export const notionReadTools = ['notion-fetch', 'notion-search'] as const;

/** Resolve a preset endpoint; presets remain distinct from legacy read-only endpoints and custom accounts. */
export function presetUrl(provider: IntegrationPreset): string {
  if (provider === 'notion') return NOTION_MCP_URL;
  return trackerUrl(provider);
}
/** Ticket tracker endpoints that Aiden can publish to. */
export function trackerUrl(provider: 'linear' | 'jira'): string {
  return provider === 'linear'
    ? 'https://mcp.linear.app/mcp'
    : 'https://mcp.atlassian.com/v2/mcp?tools=all';
}
/** Recognize the old Linear read-only catalog without merging credentials or changing permissions. */
export function readOnlyLinear(connection: McpConnection): boolean {
  return connection.url.replace(/\/$/, '') === 'https://mcp.linear.app/mcp/readonly';
}
/** Recognize a Notion context connection so it is never offered as a ticket destination. */
export function notionContext(connection: McpConnection): boolean {
  return connection.url.replace(/\/$/, '') === NOTION_MCP_URL;
}
/**
 * Notion page links in pasted text, in order and without repeats, so Aiden can read the pages a
 * person linked instead of the link text alone.
 * Example: "Spec: https://www.notion.so/acme/Booking-1a2b" yields that one URL.
 */
export function notionLinks(text: string): string[] {
  const found = text.match(/https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site|com)\/[^\s)\]>"']+/gi) ?? [];
  return [...new Set(found.map((link) => link.replace(/[.,;:!?]+$/, '')))];
}
/** A Notion connection that can read pages for Aiden: connected, with approved read tools. */
export function notionReady(connection: McpConnection): boolean {
  return (
    notionContext(connection) &&
    connection.status === 'connected' &&
    connection.approvedTools.length > 0
  );
}
/** Linear and Notion connections remain available for setup; other saved servers are experimental. */
export function experimentalIntegration(connection: McpConnection): boolean {
  return (
    connection.provider !== 'linear' &&
    connection.url.replace(/\/$/, '') !== trackerUrl('linear') &&
    !readOnlyLinear(connection) &&
    !notionContext(connection)
  );
}
/** Prefer a ready preset; otherwise reuse the most recently saved matching OAuth connection. */
export function presetConnection(
  connections: McpConnection[],
  provider: IntegrationPreset,
): McpConnection | undefined {
  return connections
    .filter((c) => c.auth === 'oauth' && c.url.replace(/\/$/, '') === presetUrl(provider))
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
  return `${connection.name}${experimentalIntegration(connection) ? ' · Experimental' : ''} · ${readOnlyLinear(connection) ? 'Read-only' : status}`;
}
