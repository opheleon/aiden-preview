import type { TicketState } from '../../contracts/src/tickets.js';
import { linearProject } from '../../integrations/src/linear-projects.js';
import type { Engine } from './engine.js';

/**
 * Upgrade a saved Linear project alias to its UUID only after an authenticated read proves the
 * original identity, team, and ownership marker. Caller holds the project lock and persists before writes.
 */
export async function resolveLinearProject(engine: Engine, state: TicketState): Promise<boolean> {
  const settings = state.settings;
  const destination = settings?.destination;
  const link = state.linearProject;
  if (!settings || destination?.provider !== 'linear' || !link) return false;
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(destination.project)) return false;
  if (
    link.id !== destination.project ||
    link.connectionId !== destination.connectionId ||
    link.teamId !== destination.team
  )
    throw new Error('The saved Linear project link does not match the ticket destination.');
  const remote = linearProject(
    await engine.integrations.linearOperation(
      destination.connectionId,
      { kind: 'get', id: destination.project },
      settings.fingerprint,
    ),
  );
  if (
    (remote.id !== destination.project && remote.identifier !== destination.project) ||
    !remote.teams.includes(destination.team) ||
    !remote.description.includes(link.marker)
  )
    throw new Error('Linear project identity, team, or recovery marker could not be verified.');
  if (remote.id === destination.project) return false;
  destination.project = remote.id;
  link.id = remote.id;
  return true;
}
