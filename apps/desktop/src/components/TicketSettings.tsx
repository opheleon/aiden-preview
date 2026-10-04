import { type JSX, useEffect, useState } from 'react';

import type {
  TicketDestination,
  TicketSettings as Settings,
  TicketState,
} from '../../../../packages/contracts/src/tickets';
import { readOnlyLinear } from '../../../../packages/contracts/src/tracker-connections';
import type { Workspace } from '../hooks/useWorkspace';
import { LinearTeamPicker } from './LinearTeamPicker';
import { TicketSave } from './TicketSave';
import { TrackerConnection } from './TrackerConnection';

/** Select a tracker destination once; saving authorizes automatic issue creation and content maintenance. */
export function TicketSettings({
  workspace,
  onSaved,
}: {
  workspace: Workspace;
  onSaved?: (state: TicketState) => void;
}): JSX.Element {
  const { call, project } = workspace;
  const [destination, setDestination] = useState<TicketDestination>({
    provider: 'linear',
    connectionId: '',
    team: '',
    project: '',
  });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [linearProject, setLinearProject] = useState<TicketState['linearProject']>();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [capabilities, setCapabilities] = useState<Pick<Settings, 'tools' | 'fingerprint'> | null>(
    null,
  );
  const [error, setError] = useState('');
  const connection = workspace.integrations.find((c) => c.id === destination.connectionId);
  const connectionStatus = connection?.status;
  const readOnly = connection ? readOnlyLinear(connection) : false;
  const ready = !readOnly && ['connected', 'needs_review'].includes(connectionStatus ?? '');
  useEffect(() => {
    let closed = false;
    void call('ticketState', { projectId: project.id })
      .then((state) => {
        if (closed) return;
        if (state?.settings) {
          setSaved(state.settings);
          setDestination(state.settings.destination);
          setEnabled(state.settings.enabled);
          setCapabilities(state.settings);
        }
        setLinearProject(state?.linearProject);
        setLoaded(true);
      })
      .catch(() => {
        if (!closed) setError('Could not load ticket settings.');
      });
    return () => {
      closed = true;
    };
  }, [call, project.id]);
  useEffect(() => {
    let closed = false;
    if (!destination.connectionId) return;
    if (readOnly || !['connected', 'needs_review'].includes(connectionStatus ?? '')) {
      return;
    }
    void call('ticketCapabilities', {
      connectionId: destination.connectionId,
      provider: destination.provider,
    })
      .then((result) => {
        if (!closed) {
          setCapabilities(result);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (!closed) setError(e instanceof Error ? e.message : 'Could not read tracker tools.');
      });
    return () => {
      closed = true;
    };
  }, [call, destination.connectionId, destination.provider, connectionStatus, readOnly]);
  return (
    <section className="card settings-panel" aria-label="Automatic tickets">
      <h2>Automatic tickets</h2>
      <p>
        Aiden creates one issue per delivery feature, reads it back to verify the contents, and
        checks it every minute while the app is open. Scope and evidence updates flow into its
        tickets. Human edits are surfaced for review.
      </p>
      <label>
        Tracker
        <select
          value={destination.provider}
          onChange={(e) => {
            setCapabilities(null);
            setLinearProject(undefined);
            setEnabled(false);
            setDestination(emptyDestination(e.target.value));
          }}
        >
          <option value="linear">Linear</option>
          <option value="jira">Jira</option>
        </select>
      </label>
      <TrackerConnection
        workspace={workspace}
        destination={destination}
        onChange={(connectionId) => {
          setCapabilities(null);
          setLinearProject(undefined);
          setEnabled(false);
          setDestination({ ...emptyDestination(destination.provider), connectionId });
        }}
      />
      <DestinationFields
        workspace={workspace}
        destination={destination}
        linearProject={linearProject}
        onChange={setDestination}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Automatically create, update, and check tickets in this destination
      </label>
      <p>
        Blocked features publish as blocked drafts. Tracker status and assignees are observed, not
        changed automatically. Marking an issue Done does not establish that its acceptance checks
        passed.
      </p>
      {ready && capabilities && (
        <details>
          <summary>Ticket operations</summary>
          <p>{[...new Set(Object.values(capabilities.tools))].join(', ')}</p>
        </details>
      )}
      {error && (!destination.connectionId || ready) && <p role="alert">{error}</p>}
      <TicketSave
        workspace={workspace}
        destination={destination}
        enabled={enabled}
        saved={saved}
        capabilities={ready ? capabilities : null}
        loaded={loaded}
        onSaved={(result) => {
          setSaved(result.settings);
          setLinearProject(result.linearProject);
          if (result.settings) setDestination(result.settings.destination);
          onSaved?.(result);
        }}
      />
    </section>
  );
}
/** Plain destination fields supported by the Linear and Jira issue contracts. */
function DestinationFields({
  workspace,
  destination: d,
  linearProject,
  onChange,
}: {
  workspace: Workspace;
  destination: TicketDestination;
  linearProject: TicketState['linearProject'];
  onChange: (value: TicketDestination) => void;
}): JSX.Element {
  return d.provider === 'linear' ? (
    <>
      <LinearTeamPicker
        key={d.connectionId}
        workspace={workspace}
        connectionId={d.connectionId}
        value={d.team}
        disabled={
          !!d.project ||
          !workspace.integrations.some(
            (c) => c.id === d.connectionId && ['connected', 'needs_review'].includes(c.status),
          )
        }
        label={linearProject?.teamName}
        onChange={(team) => onChange({ ...d, team })}
      />
      <p>
        {d.project
          ? `Linked Linear project: ${linearProject?.name ?? d.project}`
          : `New Linear project: ${workspace.project.name}`}
      </p>
      <p className="row-sub">
        {d.project
          ? 'This project keeps its existing Linear destination.'
          : 'Publishing creates a project for this scope in the selected team. Future syncs reuse it.'}
      </p>
    </>
  ) : (
    <>
      <label>
        Atlassian site URL or cloud ID
        <input value={d.cloudId} onChange={(e) => onChange({ ...d, cloudId: e.target.value })} />
      </label>
      <label>
        Jira project key
        <input
          value={d.projectKey}
          onChange={(e) => onChange({ ...d, projectKey: e.target.value })}
        />
      </label>
      <label>
        Jira issue type
        <input
          value={d.issueTypeName}
          onChange={(e) => onChange({ ...d, issueTypeName: e.target.value })}
        />
      </label>
    </>
  );
}

/** Start a newly selected tracker without carrying authorization from another destination. */
function emptyDestination(provider: string): TicketDestination {
  return provider === 'jira'
    ? { provider: 'jira', connectionId: '', cloudId: '', projectKey: '', issueTypeName: 'Task' }
    : { provider: 'linear', connectionId: '', team: '', project: '' };
}
