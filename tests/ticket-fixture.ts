import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod/v3';

import type { Product, Project } from '../packages/contracts/src/index.js';
import { commitBaseline } from '../packages/core/src/baseline.js';
import { Engine } from '../packages/core/src/engine.js';
import { atomic, Store } from '../packages/core/src/storage.js';
import { saveTicketSettings, ticketCapabilities } from '../packages/core/src/ticket-storage.js';
import { ConnectionManager } from '../packages/integrations/src/index.js';
import { serveTools } from '../packages/tools/src/mcp.js';
import { defineTool } from '../packages/tools/src/tool-definition.js';
import { linearFixture } from './linear-fixture.js';

export interface FixtureIssue {
  id: string;
  title: string;
  description: string;
  team: string;
  project: string;
  status: string;
  statusType?: string;
  assignee: string;
  url: string;
}
/** A synthetic Linear-compatible MCP over real HTTP. Never connects to a customer tracker. */
export async function ticketFixture(options: { projects?: boolean } = {}) {
  const linear = linearFixture();
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-tickets-'));
  const issues = new Map<string, FixtureIssue>();
  const behavior = {
    failAfterCreate: false,
    failBeforeCreate: false,
    missingSearch: false,
    failGet: false,
    changedContract: false,
  };
  const calls: string[] = [];
  const defs = [
    defineTool({
      name: 'save_issue',
      description: 'Synthetic issue write',
      readOnly: true,
      schema: z.object({
        id: z.string().optional(),
        title: z.string(),
        description: z.string(),
        team: z.string().optional(),
        project: z.string().optional(),
      }),
      run: (input) => {
        calls.push(input.id ? 'update' : 'create');
        if (behavior.failBeforeCreate) throw new Error('Synthetic denied');
        const id = input.id ?? `issue-${issues.size + 1}`;
        const previous = issues.get(id);
        issues.set(id, {
          id,
          title: input.title,
          description: input.description,
          team: input.team ?? previous?.team ?? '',
          project: input.project ?? previous?.project ?? '',
          status: previous?.status ?? 'Todo',
          assignee: 'Alex',
          url: `https://linear.app/fixture/issue/${id}`,
        });
        if (behavior.failAfterCreate) throw new Error('Synthetic connection failed after write');
        return { id };
      },
    }),
    defineTool({
      name: 'get_issue',
      description: 'Synthetic issue read',
      schema: z.object({ id: z.string() }),
      run: ({ id }) => {
        calls.push('get');
        if (behavior.failGet) throw new Error('Synthetic offline');
        return issues.get(id);
      },
    }),
    defineTool({
      name: 'list_issues',
      description: 'Synthetic issue search',
      schema: z.object({
        query: z.string(),
        team: z.string(),
        project: z.string(),
        limit: z.number(),
      }),
      run: ({ query }) => {
        calls.push('search');
        return {
          issues: behavior.missingSearch
            ? []
            : [...issues.values()]
                .filter((i) => i.description.includes(query))
                .map(({ id }) => ({ id })),
        };
      },
    }),
  ];
  if (options.projects) defs.push(...linear.definitions);
  const server = await serveTools({
    definitions: () =>
      defs.map((d) => ({
        ...d,
        description: behavior.changedContract ? 'Changed contract' : d.description,
      })),
    call: (name, input) =>
      Promise.resolve().then(() => defs.find((d) => d.name === name)!.run(input)),
  });
  const store = new Store(root);
  const integrations = new ConnectionManager(root, { keyring: false });
  const engine = new Engine(
    store,
    {
      run: () => {
        throw new Error('No model call should be made by ticket sync');
      },
    },
    () => {},
    integrations,
  );
  const project: Project = {
    id: 'fixture',
    name: 'Synthetic ticket project',
    context: 'Deliver books',
    repositories: [],
    runtime: { provider: 'codex', auth: 'subscription' },
  };
  const product: Product = {
    overview: 'Deliver books',
    milestones: [],
    requirements: [
      { id: 'REQ-1', text: 'List books' },
      { id: 'REQ-2', text: 'Create books' },
    ],
    deliveryPlan: [1, 2].map((n) => ({
      id: `F-${n}`,
      title: `Feature ${n}`,
      outcome: `Behavior ${n}`,
      rationale: 'Vertical feature',
      kind: 'feature',
      requirementIds: [`REQ-${n}`],
      dependsOn: n === 2 ? ['F-1'] : [],
    })),
  };
  await atomic(path.join(store.project(project.id), 'project.json'), project);
  await commitBaseline(store, project.id, product, project.context);
  const connection = await integrations.add({
    name: 'Synthetic Linear',
    provider: 'custom',
    url: server.url,
    auth: 'bearer',
    bearer: server.token,
    sessionOnly: true,
  });
  await integrations.connect(connection.id);
  const settings = {
    enabled: true,
    destination: {
      provider: 'linear' as const,
      connectionId: connection.id,
      team: 'Books',
      project: 'Library',
    },
    ...(await ticketCapabilities(engine, connection.id, 'linear')),
  };
  return {
    root,
    linear,
    server,
    engine,
    store,
    project,
    product,
    connection,
    settings,
    issues,
    behavior,
    calls,
    enable: () => saveTicketSettings(engine, project.id, settings),
    close: async () => {
      await engine.dispose();
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
