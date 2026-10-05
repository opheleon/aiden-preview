import { type JSX, useState } from 'react';

import type { TicketState } from '../../../../packages/contracts/src/tickets';
import type { TrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import { TicketSettings } from './TicketSettings';

/** Make connecting later and reconciling existing tickets available beside their requirements. */
export function TicketPublishing({
  workspace,
  tracker,
}: {
  workspace: Workspace;
  tracker: TrackerTickets;
}): JSX.Element {
  const [configuring, setConfiguring] = useState(false);
  const { state, syncing } = tracker;
  const enabled = state?.settings?.enabled;
  const published = state?.records.some((r) => r.issueId);
  return (
    <div className="ticket-publishing">
      <div className="card-label-row">
        <p className="row-sub">{publishingLabel(state)}</p>
        <div className="button-row">
          {enabled && (
            <button
              className="text-button"
              disabled={syncing || workspace.busy}
              onClick={() => void tracker.sync()}
            >
              {syncing ? 'Syncing tickets…' : published ? 'Sync tickets' : 'Publish tickets'}
            </button>
          )}
          <button
            className="text-button"
            disabled={syncing || workspace.busy}
            aria-expanded={configuring}
            onClick={() => setConfiguring(!configuring)}
          >
            {configuring
              ? 'Close publishing settings'
              : state?.settings
                ? 'Publishing settings'
                : 'Connect tracker'}
          </button>
        </div>
      </div>
      {workspace.busy && enabled && (
        <p className="row-sub">Tickets can sync when the current run finishes.</p>
      )}
      <PublishingHealth state={state} />
      {configuring && (
        <TicketSettings
          key={workspace.project.id}
          workspace={workspace}
          onSaved={(result) => {
            tracker.saved(result);
            setConfiguring(false);
          }}
        />
      )}
    </div>
  );
}

/** Keep the summary factual for local, paused, and enabled destinations. */
function publishingLabel(state: TicketState | null): string {
  if (!state?.settings) return 'Tickets are local until you connect a tracker.';
  if (!state.settings.enabled) return 'Automatic publishing paused';
  return `Tickets linked to ${state.settings.destination.provider === 'linear' ? 'Linear' : 'Jira'} · Automatic sync on`;
}

/** Surface failures and retired tickets even while requirement details are collapsed. */
function PublishingHealth({ state }: { state: TicketState | null }): JSX.Element {
  const attention =
    state?.records.filter((r) => ['conflict', 'uncertain', 'error'].includes(r.state)).length ?? 0;
  return (
    <>
      {state?.linearProject?.url && (
        <a href={state.linearProject.url} target="_blank" rel="noreferrer">
          Open Linear project: {state.linearProject.name}
        </a>
      )}
      {state?.checkedAt && (
        <p className="row-sub" role="status">
          Last synced {new Date(state.checkedAt).toLocaleString()}.
        </p>
      )}
      {state?.error && <p role="alert">{state.error}</p>}
      {!!attention && (
        <p role="alert">
          {attention} ticket(s) need attention. Expand their requirements for details.
        </p>
      )}
      {state?.records
        .filter((r) => r.state === 'retired')
        .map((r) => (
          <RetiredTicket key={r.featureId} record={r} />
        ))}
    </>
  );
}

/**
 * Name a feature removed from the plan by its ID and title, and link the preserved tracker issue
 * so the person can review or close it. Example: "Removed from the plan: F-4 Enforce expiry."
 */
function RetiredTicket({ record }: { record: TicketState['records'][number] }): JSX.Element {
  const title = record.title.replace(/^\[Blocked\]\s*/, '');
  const issue = record.issueId ?? 'its tracker issue';
  return (
    <p role="status">
      Removed from the plan: {record.featureId} {title}. Aiden kept{' '}
      {record.url ? (
        <a href={record.url} target="_blank" rel="noreferrer">
          {issue}
        </a>
      ) : (
        issue
      )}{' '}
      for review; close it in the tracker if the work is no longer needed.
    </p>
  );
}
