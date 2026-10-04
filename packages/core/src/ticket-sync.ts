import type { DeliveryFeature } from '../../contracts/src/index.js';
import type { TicketState } from '../../contracts/src/tickets.js';
import type { DeliveryTicket } from '../../reporting/src/tickets.js';
import { deliveryTickets } from '../../reporting/src/tickets.js';
import { publicError } from '../../runtimes/src/index.js';
import { readCalls } from './calls.js';
import type { Engine } from './engine.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { hash } from './storage.js';
import { resolveLinearProject } from './ticket-project.js';
import { reconcileTicket } from './ticket-reconcile.js';
import { readTicketState, writeTicketState } from './ticket-storage.js';

/** Coalesce overlapping watcher, settings, and completed-run syncs within a worker. */
const active = new WeakMap<Engine, Map<string, Promise<TicketState>>>();
/** Automatically publish/check tickets when configured; uncertain creates recover through search only. */
export function syncTickets(engine: Engine, projectId: string): Promise<TicketState> {
  const map = active.get(engine) ?? new Map<string, Promise<TicketState>>();
  active.set(engine, map);
  const existing = map.get(projectId);
  if (existing) return existing;
  const task = reconcile(engine, projectId).finally(() => map.delete(projectId));
  map.set(projectId, task);
  return task;
}
/** Hold the project lock across scope reads and remote writes so an old plan cannot overwrite a new one. */
async function reconcile(engine: Engine, projectId: string): Promise<TicketState> {
  const initial = await readTicketState(engine.store, projectId);
  if (!initial.settings?.enabled || engine.isBusy(projectId)) return initial;
  const release = await acquireProjectLock(engine.store, projectId);
  try {
    const state = await readTicketState(engine.store, projectId);
    if (!state.settings?.enabled) return state;
    const { baseline, runs } = await engine.state(projectId);
    if (!baseline) return state;
    if (!baseline.product.deliveryPlan)
      throw new Error('Plan delivery before enabling automatic tracker tickets.');
    const latest = runs.find(
      (r) => r.kind === 'report' && r.status === 'completed' && r.baseline?.id === baseline.id,
    );
    const report = latest ? await engine.getReport(projectId, latest.id) : undefined;
    const tickets = deliveryTickets(
      baseline.product,
      report,
      await readCalls(engine.store, projectId),
    );
    delete state.error;
    if (await resolveLinearProject(engine, state))
      await writeTicketState(engine.store, projectId, state);
    for (const ticket of tickets)
      await syncFeature(engine, projectId, state, ticket, baseline.product.deliveryPlan);
    for (const record of state.records.filter((r) => !tickets.some((t) => t.id === r.featureId))) {
      record.state = 'retired';
      record.message =
        'Removed from the delivery plan. The external issue is preserved for review.';
    }
    state.needsAssessment =
      !!state.externalChangeAt && (!latest || latest.createdAt < state.externalChangeAt);
    state.checkedAt = new Date().toISOString();
    await writeTicketState(engine.store, projectId, state);
    return state;
  } catch (error) {
    const state = await readTicketState(engine.store, projectId);
    state.error = publicError(error);
    await writeTicketState(engine.store, projectId, state);
    return state;
  } finally {
    await release();
  }
}

/** Publish one feature and record recoverable failures without preventing independent tickets. */
async function syncFeature(
  engine: Engine,
  projectId: string,
  state: TicketState,
  ticket: DeliveryTicket,
  plan: DeliveryFeature[],
): Promise<void> {
  let record = state.records.find((r) => r.featureId === ticket.id);
  if (!record) {
    record = {
      featureId: ticket.id,
      marker: `aiden-ticket-${hash([projectId, ticket.id]).slice(0, 32)}`,
      title: ticket.title,
      state: 'pending',
    };
    state.records.push(record);
  }
  if (record.state === 'retired') {
    record.message =
      'A retired feature ID was reused. Allocate a new feature ID before publishing.';
    return;
  }
  const previousStatus = record.remoteStatus;
  const previousType = record.remoteStatusType;
  const dependencies = plan.find((f) => f.id === ticket.id)!.dependsOn;
  const links = dependencies.map((id) => {
    const prerequisite = state.records.find((r) => r.featureId === id);
    return prerequisite?.issueId
      ? `${id}: ${prerequisite.url ?? prerequisite.issueId}`
      : `${id}: publication pending`;
  });
  const linked = links.length
    ? {
        ...ticket,
        markdown: `${ticket.markdown}\n\nPrerequisite tickets:\n${links.join('\n')}`,
      }
    : ticket;
  try {
    await reconcileTicket(engine, projectId, state, record, linked);
  } catch (error) {
    record.state = record.pendingHash ? 'uncertain' : 'error';
    record.message = publicError(error);
  }
  const firstClosedObservation =
    !previousStatus && ['completed', 'canceled'].includes(record.remoteStatusType ?? '');
  if (
    (previousStatus &&
      (record.remoteStatus !== previousStatus || record.remoteStatusType !== previousType)) ||
    firstClosedObservation
  ) {
    state.externalChangeAt = new Date().toISOString();
    record.remoteStatusChangedAt = state.externalChangeAt;
  }
  await writeTicketState(engine.store, projectId, state);
}
