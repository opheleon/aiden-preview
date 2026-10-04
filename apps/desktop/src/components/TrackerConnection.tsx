import { type JSX, useState } from 'react';

import type { TicketDestination } from '../../../../packages/contracts/src/tickets';
import {
  readOnlyLinear,
  trackerLabel,
} from '../../../../packages/contracts/src/tracker-connections';
import type { Workspace } from '../hooks/useWorkspace';

/** Distinguish legacy readers from publishing connections and reconnect the selected identity in place. */
export function TrackerConnection({
  workspace,
  destination,
  onChange,
}: {
  workspace: Workspace;
  destination: TicketDestination;
  onChange: (id: string) => void;
}): JSX.Element {
  const [connecting, setConnecting] = useState(false);
  const selected = workspace.integrations.find((c) => c.id === destination.connectionId);
  const candidates = workspace.integrations.filter(
    (c) => !readOnlyLinear(c) || c.id === destination.connectionId,
  );
  const ready = selected && ['connected', 'needs_review'].includes(selected.status);
  const waiting = selected?.status === 'authorization_required';
  return (
    <>
      <label>
        MCP connection
        <select value={destination.connectionId} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a tracker connection</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id} disabled={readOnlyLinear(c)}>
              {trackerLabel(c)}
            </option>
          ))}
        </select>
      </label>
      {selected && !ready && (
        <div>
          <p className="row-sub">
            {waiting
              ? 'Finish signing in in your browser. This page updates automatically.'
              : 'This saved connection needs to reconnect before you can choose a team or publish.'}
          </p>
          <button
            className="secondary"
            disabled={connecting || waiting}
            onClick={() =>
              void workspace.action(async () => {
                setConnecting(true);
                try {
                  await workspace.call('integrationConnect', { connectionId: selected.id });
                } finally {
                  workspace.setIntegrations(await workspace.call('integrations'));
                  setConnecting(false);
                }
              })
            }
          >
            {connecting ? 'Connecting…' : `Reconnect ${selected.name}`}
          </button>
        </div>
      )}
      {selected && readOnlyLinear(selected) && (
        <p role="alert">
          This older connection is read-only. Select the publishing connection or connect Linear in
          Integrations.
        </p>
      )}
      <button
        className="text-button"
        onClick={() => {
          workspace.setSettingsTab('integrations');
          workspace.setArea('settings');
        }}
      >
        Manage tracker connections
      </button>
    </>
  );
}
