import path from 'node:path';

import type { TicketSettings, TicketState } from '../../contracts/src/tickets.js';
import { TicketSettingsSchema, TicketStateSchema } from '../../contracts/src/tickets.js';
import {
  ticketArguments,
  ticketTools,
  validateTicketArguments,
} from '../../integrations/src/ticket-tools.js';
import type { Engine } from './engine.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { atomic, hash, optionalJson, type Store } from './storage.js';

/** Read a project's durable ticket identities, including incomplete remote write attempts. */
export async function readTicketState(store: Store, projectId: string): Promise<TicketState> {
  return TicketStateSchema.parse(
    (await optionalJson(path.join(store.project(projectId), 'tickets.json'))) ?? {
      settings: null,
      records: [],
    },
  );
}
/** Persist ticket state before and after each external mutation. */
export async function writeTicketState(
  store: Store,
  projectId: string,
  state: TicketState,
): Promise<void> {
  await atomic(path.join(store.project(projectId), 'tickets.json'), TicketStateSchema.parse(state));
}
/** Discover supported issue operations and pin their actual schemas for project-level consent. */
export async function ticketCapabilities(
  engine: Engine,
  connectionId: string,
  provider: 'linear' | 'jira',
): Promise<Pick<TicketSettings, 'tools' | 'fingerprint'>> {
  const connection = await engine.integrations.get(connectionId);
  if (!['connected', 'needs_review'].includes(connection.status))
    throw new Error('Connect the tracker first.');
  const inventory = await engine.integrations.refreshTools(connectionId);
  const current = await engine.integrations.get(connectionId);
  return { tools: ticketTools(provider, inventory), fingerprint: current.toolFingerprint! };
}
/** Grant automatic publishing only to the explicitly selected destination and reviewed issue contracts. */
export async function saveTicketSettings(
  engine: Engine,
  projectId: string,
  input: unknown,
): Promise<TicketState> {
  const settings = TicketSettingsSchema.parse(input);
  const release = await acquireProjectLock(engine.store, projectId);
  try {
    if (!(await engine.state(projectId)).project) throw new Error('Save this project first.');
    const state = await readTicketState(engine.store, projectId);
    if (state.records.length && hash(state.settings?.destination) !== hash(settings.destination))
      throw new Error(
        'This project already has linked tickets. Keep their destination to avoid duplicates; use a separate Aiden project for another destination.',
      );
    if (state.linearProject) {
      const link = state.linearProject;
      const d = settings.destination;
      if (
        d.provider !== 'linear' ||
        d.connectionId !== link.connectionId ||
        d.team !== link.teamId ||
        d.project !== link.id
      )
        throw new Error('Keep the linked Linear project destination to avoid duplicates.');
    }
    await validateTicketSettings(engine, settings);
    state.settings = settings;
    delete state.error;
    await writeTicketState(engine.store, projectId, state);
    return state;
  } finally {
    await release();
  }
}

/** Validate issue authorization and argument contracts before any destination or project writes. */
export async function validateTicketSettings(
  engine: Engine,
  settings: TicketSettings,
): Promise<void> {
  if (settings.enabled) {
    const inventory = await engine.integrations.refreshTools(settings.destination.connectionId);
    const capabilities = await ticketCapabilities(
      engine,
      settings.destination.connectionId,
      settings.destination.provider,
    );
    if (
      hash(capabilities.tools) !== hash(settings.tools) ||
      capabilities.fingerprint !== settings.fingerprint
    )
      throw new Error('Ticket tool contracts changed. Review them again.');
    for (const op of ['create', 'update', 'get', 'search'] as const)
      validateTicketArguments(
        inventory.find((tool) => tool.name === settings.tools[op])!,
        ticketArguments(settings, op, {
          id: 'schema-check',
          title: 'Schema check',
          description: 'Schema check',
          marker: `aiden-ticket-${'a'.repeat(32)}`,
        }),
      );
  }
}
