import { type JSX, useState } from 'react';

import type {
  TicketDestination,
  TicketSettings,
  TicketState,
} from '../../../../packages/contracts/src/tickets';
import type { Workspace } from '../hooks/useWorkspace';

/** Publish into one scope-named Linear project, or preserve an existing tracker destination. */
export function TicketSave({
  workspace,
  destination,
  enabled,
  saved,
  capabilities,
  loaded,
  onSaved,
}: {
  workspace: Workspace;
  destination: TicketDestination;
  enabled: boolean;
  saved: TicketSettings | null;
  capabilities: Pick<TicketSettings, 'tools' | 'fingerprint'> | null;
  loaded: boolean;
  onSaved: (state: TicketState) => void;
}): JSX.Element {
  const [saving, setSaving] = useState(false);
  const createProject = enabled && destination.provider === 'linear' && !destination.project;
  const missingTeam =
    destination.provider === 'linear' && !(enabled ? destination.team : destination.project);
  return (
    <button
      disabled={
        !loaded || (!capabilities && (enabled || !saved)) || workspace.busy || saving || missingTeam
      }
      onClick={() =>
        void workspace.action(async () => {
          setSaving(true);
          try {
            const result =
              createProject && destination.provider === 'linear'
                ? await workspace.call('publishLinearTickets', {
                    projectId: workspace.project.id,
                    connectionId: destination.connectionId,
                    teamId: destination.team,
                    ...capabilities!,
                  })
                : await workspace.call('saveTicketSettings', {
                    projectId: workspace.project.id,
                    settings:
                      !enabled && saved
                        ? { ...saved, enabled: false }
                        : { enabled, destination, ...capabilities! },
                  });
            onSaved(result);
            const problems =
              result.error ||
              result.records.some((r) => ['error', 'uncertain', 'conflict'].includes(r.state));
            workspace.setNotice(
              !enabled
                ? 'Automatic tickets paused.'
                : problems
                  ? 'Ticket settings saved. Some tickets need attention on the project page.'
                  : 'Ticket settings saved. Aiden will create and check tickets automatically.',
            );
          } finally {
            setSaving(false);
          }
        })
      }
    >
      {saving
        ? 'Publishing…'
        : createProject
          ? 'Create project and publish tickets'
          : enabled
            ? 'Save and publish tickets'
            : 'Save ticket settings'}
    </button>
  );
}
