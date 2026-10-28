import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import type { ExecutionActivity } from '../../contracts/src/accounts-execution.js';
import { completion, selectModel } from './codex.js';
import { serverPageSchema, threadSchema } from './codex-schemas.js';
import { shellStep } from './coding-progress.js';
import { cleanEnvironment } from './environment.js';
import type { RpcClient, RpcMessage } from './rpc.js';
import type { RuntimeRequest, RuntimeResult } from './types.js';

const exec = promisify(execFile);

/** Starts a Codex app server with extra `-c` overrides and environment for this turn. */
export type CodingClientFactory = (
  overrides: string[],
  env: NodeJS.ProcessEnv,
) => Promise<RpcClient>;

/**
 * Git and package-manager settings for unattended coding: hooks and filesystem monitors stay off,
 * as in Claude Code's coding mode, and caches go to the temporary folder the sandbox can write.
 */
export function codingEnvironment(): NodeJS.ProcessEnv {
  const cache = path.join(os.tmpdir(), 'aiden-coding-cache');
  return {
    ...cleanEnvironment(),
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_KEY_1: 'core.fsmonitor',
    GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'protocol.ext.allow',
    GIT_CONFIG_VALUE_2: 'never',
    XDG_CACHE_HOME: cache,
    npm_config_cache: path.join(cache, 'npm'),
    npm_config_store_dir: path.join(cache, 'pnpm-store'),
    YARN_CACHE_FOLDER: path.join(cache, 'yarn'),
    PIP_CACHE_DIR: path.join(cache, 'pip'),
  };
}

/**
 * Folders the session may write: each worktree, and the Git folder its commits land in. A worktree
 * keeps objects and refs in the clone it came from, so committing needs that clone's `.git` too.
 * Example: a worktree of `.../code/github/acme/api` also gets `.../code/github/acme/api/.git`.
 */
export async function writableRoots(cwd: string, directories: string[] = []): Promise<string[]> {
  const roots = new Set<string>();
  for (const dir of [cwd, ...directories]) {
    roots.add(path.resolve(dir));
    const { stdout } = await exec(
      'git',
      ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 10_000, env: cleanEnvironment() },
    );
    roots.add(stdout.trim());
  }
  return [...roots];
}

/**
 * `-c` overrides for a coding permission profile: read the whole machine so build tools run,
 * write only the job's worktrees, their Git folder, and temporary folders, and allow the network
 * for installs and tests. Codex enforces the profile in its own sandbox.
 */
export function codingPermissions(profile: string, roots: string[]): string[] {
  const writable = roots.map((root) => `${JSON.stringify(root)}="write"`).join(',');
  return [
    `permissions.${profile}.filesystem={":root"="read",":tmpdir"="write",":slash_tmp"="write",${writable}}`,
    `permissions.${profile}.network.enabled=true`,
    `default_permissions=${JSON.stringify(profile)}`,
  ];
}

/** Codex features a coding session never needs; its own shell and file editing stay on. */
const disabledFeatures = [
  'apps',
  'plugins',
  'hooks',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'computer_use',
  'image_generation',
  'in_app_browser',
  'memories',
  'remote_plugin',
  'enable_mcp_apps',
  'skill_mcp_dependency_install',
  'tool_suggest',
];

/** Thread config: inherited MCP servers off, only Aiden's status tool on when the task has one. */
async function codingConfig(
  client: RpcClient,
  request: RuntimeRequest,
): Promise<Record<string, unknown>> {
  const current = z
    .object({ config: z.object({ mcp_servers: z.record(z.unknown()).optional() }) })
    .parse(await client.request('config/read', { includeLayers: false }));
  const servers: Record<string, unknown> = Object.fromEntries(
    Object.keys(current.config.mcp_servers ?? {}).map((key) => [key, { enabled: false }]),
  );
  if (request.tools.url)
    servers.aiden_status = {
      url: request.tools.url,
      http_headers: { Authorization: `Bearer ${request.tools.token}` },
      default_tools_approval_mode: 'approve',
    };
  return {
    features: Object.fromEntries(disabledFeatures.map((key) => [key, false])),
    mcp_servers: servers,
    agents: { enabled: false },
    model_reasoning_effort: request.config.effort ?? 'medium',
  };
}

/** Stop before the prompt if any MCP server other than Aiden's status tool exposes tools. */
async function verifyCodingTools(client: RpcClient, threadId: string): Promise<void> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = serverPageSchema.parse(
      await client.request('mcpServerStatus/list', { threadId, cursor }),
    );
    if (page.data.some((s) => s.name !== 'aiden_status' && Object.keys(s.tools).length))
      throw new Error('Unexpected MCP tools are enabled. Aiden stopped before coding.');
    cursor = page.nextCursor ?? undefined;
    if (cursor && (seen.has(cursor) || seen.size >= 10))
      throw new Error('Tool discovery returned repeated or excessive pages.');
    if (cursor) seen.add(cursor);
  } while (cursor);
}

const codingItemSchema = z.object({
  threadId: z.string(),
  item: z
    .object({
      type: z.string(),
      id: z.string(),
      command: z.string().optional(),
      server: z.string().optional(),
      tool: z.string().optional(),
      changes: z.array(z.object({ path: z.string() })).optional(),
    })
    .passthrough(),
});
/** One Codex thread item, reduced to the fields progress and activity read. */
type CodingItem = z.infer<typeof codingItemSchema>['item'];

/** Item types that are tool calls; the watchdog times each from start to completion. */
const toolItems = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch']);

/** The command a shell item runs, without Codex's `bash -lc '...'` wrapper. */
function unwrapShell(command: string): string {
  const wrapped = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(command);
  return wrapped ? wrapped[2]! : command;
}

/**
 * A started tool call as one plain step, matching Claude Code's wording.
 * Examples: `pnpm test` is "Running tests"; a patch to `src/app.tsx` is "Editing app.tsx".
 */
export function codexStep(item: CodingItem): string | undefined {
  if (item.type === 'commandExecution' && item.command) return shellStep(unwrapShell(item.command));
  if (item.type === 'fileChange') {
    const files = (item.changes ?? []).map((change) => path.basename(change.path));
    return files.length === 1 ? `Editing ${files[0]}` : 'Editing files';
  }
  if (item.type === 'webSearch') return 'Searching the web';
  if (item.type === 'mcpToolCall' && item.server !== 'aiden_status' && item.tool)
    return `Using ${item.tool}`;
  return undefined;
}

/** Watchdog activity for one item notification; status reports never count as activity. */
export function codexActivity(method: string, item: CodingItem): ExecutionActivity[] {
  if (item.type === 'mcpToolCall' && item.server === 'aiden_status') return [];
  if (toolItems.has(item.type))
    return [{ type: method === 'item/started' ? 'tool-start' : 'tool-end', id: item.id }];
  return method === 'item/completed' && (item.type === 'agentMessage' || item.type === 'reasoning')
    ? [{ type: 'output' }]
    : [];
}

/** Forward one thread's progress and activity until the turn ends. */
function observe(client: RpcClient, threadId: string, request: RuntimeRequest): () => void {
  /** Read item notifications for this thread only; anything malformed is ignored, not fatal. */
  const listener = (message: RpcMessage): void => {
    if (message.method !== 'item/started' && message.method !== 'item/completed') return;
    const parsed = codingItemSchema.safeParse(message.params);
    if (!parsed.success || parsed.data.threadId !== threadId) return;
    for (const activity of codexActivity(message.method, parsed.data.item))
      request.activity?.(activity);
    const step = message.method === 'item/started' ? codexStep(parsed.data.item) : undefined;
    if (step) request.progress(step);
  };
  client.listeners.add(listener);
  return () => client.listeners.delete(listener);
}

const unattended =
  'This is unattended work: no person can approve requests or answer questions during it. Work only in the listed worktrees and their job branches. Report a needed approval, a blocker, or a question through aiden_status.report_status, then continue independent authorized work. Return the requested JSON when you finish.';

/**
 * Run one Codex coding session in the job's worktrees, with Codex's own shell and file editing,
 * only Aiden's status tool, and no approvals. The caller supervises time limits and cancellation.
 */
export async function runCodexCoding(
  request: RuntimeRequest,
  createClient: CodingClientFactory,
  key?: string,
): Promise<RuntimeResult> {
  const profile = 'aiden-coding-' + randomUUID();
  const roots = await writableRoots(request.cwd, request.coding?.directories);
  const client = await createClient(codingPermissions(profile, roots), codingEnvironment());
  /** Close the app server, which ends the turn, on cancellation. */
  const stop = (): void => {
    client.close();
  };
  request.signal.addEventListener('abort', stop, { once: true });
  /** Removes the progress listener; there is none until the thread starts. */
  let unobserve = (): void => {};
  try {
    request.signal.throwIfAborted();
    const model = await selectModel(client, request, key);
    const thread = threadSchema.parse(
      await client.request('thread/start', {
        cwd: request.cwd,
        model,
        approvalPolicy: 'never',
        permissions: profile,
        ephemeral: true,
        developerInstructions: unattended,
        config: await codingConfig(client, request),
        selectedCapabilityRoots: [],
      }),
    );
    await verifyCodingTools(client, thread.thread.id);
    unobserve = observe(client, thread.thread.id, request);
    const completed = completion(client, thread.thread.id);
    // Cancellation can reject completion while turn/start is still pending.
    void completed.catch(() => {});
    await client.request('turn/start', {
      threadId: thread.thread.id,
      input: [{ type: 'text', text: request.prompt, text_elements: [] }],
      outputSchema: request.schema,
      permissions: profile,
    });
    const value = await completed;
    const version = (
      await exec(process.env.AIDEN_CODEX_BINARY || 'codex', ['--version'], {
        timeout: 10_000,
        env: cleanEnvironment(),
      })
    ).stdout.trim();
    return { value, model, version };
  } finally {
    unobserve();
    request.signal.removeEventListener('abort', stop);
    client.close();
  }
}
