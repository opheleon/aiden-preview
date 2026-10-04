import type {
  LinearProjectLink,
  LinearTeam,
  TicketSettings,
  TicketState,
} from '../../contracts/src/tickets.js';
import {
  linearOperation,
  linearPage,
  type LinearProject,
  linearProject,
  linearProjectId,
  linearTeam,
} from '../../integrations/src/linear-projects.js';
import type { Engine } from './engine.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { hash } from './storage.js';
import { readTicketState, validateTicketSettings, writeTicketState } from './ticket-storage.js';
import { syncTickets } from './ticket-sync.js';

/** Fetch all available teams lazily for the selected connection, rejecting ambiguous pagination. */
export async function linearTeams(engine: Engine, connectionId: string): Promise<LinearTeam[]> {
  const teams: LinearTeam[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await engine.integrations.linearOperation(connectionId, {
      kind: 'teams',
      ...(cursor ? { cursor } : {}),
    });
    const page = linearPage(result, 'teams');
    teams.push(...page.rows.map(linearTeam));
    cursor = page.cursor;
    if (cursor && (seen.has(cursor) || seen.size >= 20))
      throw new Error('Linear team discovery did not finish. Retry the team list.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...new Map(teams.map((team) => [team.id, team])).values()];
}

/** Create or recover one Linear project, then authorize and publish its feature tickets. */
export async function publishLinearTickets(
  engine: Engine,
  projectId: string,
  input: {
    connectionId: string;
    teamId: string;
    fingerprint: string;
    tools: TicketSettings['tools'];
  },
): Promise<TicketState> {
  const release = await acquireProjectLock(engine.store, projectId);
  try {
    if (engine.isBusy(projectId))
      throw new Error('Wait for the current run to finish before publishing.');
    const project = await engine.state(projectId);
    if (!project.project || !project.baseline?.product.deliveryPlan)
      throw new Error('Plan delivery before publishing a Linear project.');
    const state = await readTicketState(engine.store, projectId);
    assertDestination(state, input.connectionId, input.teamId);
    const settings: TicketSettings = {
      enabled: true,
      destination: {
        provider: 'linear',
        connectionId: input.connectionId,
        team: input.teamId,
        project: 'pending-project',
      },
      fingerprint: input.fingerprint,
      tools: input.tools,
    };
    await validateTicketSettings(engine, settings);
    const team = (await linearTeams(engine, input.connectionId)).find(
      (team) => team.id === input.teamId,
    );
    if (!team) throw new Error('Choose an available Linear team before publishing.');
    const existing = state.settings?.destination;
    const projectIdentity =
      existing?.provider === 'linear'
        ? existing.project
        : await ensureProject(
            engine,
            projectId,
            state,
            { ...input, teamName: team.name },
            project.project.name,
          );
    settings.destination = {
      provider: 'linear',
      connectionId: input.connectionId,
      team: input.teamId,
      project: projectIdentity,
    };
    await validateTicketSettings(engine, settings);
    state.settings = settings;
    delete state.error;
    await writeTicketState(engine.store, projectId, state);
  } finally {
    await release();
  }
  return syncTickets(engine, projectId);
}

/** Prevent changing the destination of existing tickets or an uncertain project creation. */
function assertDestination(state: TicketState, connectionId: string, teamId: string): void {
  const saved = state.settings?.destination;
  if (
    saved &&
    (saved.provider !== 'linear' || saved.connectionId !== connectionId || saved.team !== teamId)
  )
    throw new Error('Keep the existing tracker destination to avoid duplicating this project.');
  if (
    state.linearProject &&
    (state.linearProject.connectionId !== connectionId || state.linearProject.teamId !== teamId)
  )
    throw new Error(
      'This project already has a Linear creation record. Reconcile its original destination before changing teams.',
    );
}

/** A durable pending marker prevents blind retries when a remote create succeeds but its reply is lost. */
async function ensureProject(
  engine: Engine,
  projectId: string,
  state: TicketState,
  input: {
    connectionId: string;
    teamId: string;
    teamName: string;
    fingerprint: string;
  },
  name: string,
): Promise<string> {
  const previous = state.linearProject;
  const link: LinearProjectLink = previous ?? {
    connectionId: input.connectionId,
    teamId: input.teamId,
    teamName: input.teamName,
    name,
    marker: `aiden-project-${hash({ projectId }).slice(0, 32)}`,
    state: 'pending',
  };
  const remote = link.id
    ? await readProject(engine, link, link.id, input.fingerprint)
    : await findProject(engine, link, input.fingerprint);
  if (remote) return saveLink(engine, projectId, state, link, remote);
  if (previous)
    throw new Error(
      'Linear project creation is still unconfirmed. Retry to find the original project; Aiden will not create a duplicate.',
    );
  const inventory = await engine.integrations.refreshTools(input.connectionId);
  const description = `Delivery managed by Aiden.\n\n${link.marker}`;
  linearOperation(inventory, { kind: 'get', id: 'schema-check' });
  linearOperation(inventory, { kind: 'create', team: input.teamId, name: link.name, description });
  state.linearProject = link;
  await writeTicketState(engine.store, projectId, state);
  const created = await engine.integrations.linearOperation(
    input.connectionId,
    {
      kind: 'create',
      team: input.teamId,
      name: link.name,
      description: `Delivery managed by Aiden.\n\n${link.marker}`,
    },
    input.fingerprint,
  );
  link.id = linearProjectId(created);
  await writeTicketState(engine.store, projectId, state);
  return saveLink(
    engine,
    projectId,
    state,
    link,
    await readProject(engine, link, link.id, input.fingerprint),
  );
}

/** Search a bounded name-and-team result and independently read candidates before adopting their marker. */
async function findProject(
  engine: Engine,
  link: LinearProjectLink,
  fingerprint: string,
): Promise<LinearProject | undefined> {
  const result = await engine.integrations.linearOperation(
    link.connectionId,
    { kind: 'search', team: link.teamId, name: link.name },
    fingerprint,
  );
  const page = linearPage(result, 'projects');
  if (page.cursor)
    throw new Error(
      'Linear project search is incomplete. Narrow the destination before publishing.',
    );
  const matches: LinearProject[] = [];
  for (const candidate of page.rows) {
    const value = await engine.integrations.linearOperation(
      link.connectionId,
      { kind: 'get', id: linearProjectId(candidate) },
      fingerprint,
    );
    const project = linearProject(value);
    if (project.description.includes(link.marker)) {
      verifyProject(project, link);
      matches.push(project);
    }
  }
  if (matches.length > 1)
    throw new Error(
      'Multiple Linear projects have the same recovery marker. Review them before publishing.',
    );
  return matches[0];
}

/** Read the known project and verify its exact destination and stable ownership marker. */
async function readProject(
  engine: Engine,
  link: LinearProjectLink,
  id: string,
  fingerprint: string,
): Promise<LinearProject> {
  const project = linearProject(
    await engine.integrations.linearOperation(link.connectionId, { kind: 'get', id }, fingerprint),
  );
  if (project.id !== id && project.identifier !== id)
    throw new Error('Linear returned a different project identity.');
  verifyProject(project, link);
  return project;
}

/** A matching name is not ownership: only the original marker and selected team establish the link. */
function verifyProject(project: LinearProject, link: LinearProjectLink): void {
  if (!project.teams.includes(link.teamId) || !project.description.includes(link.marker))
    throw new Error(
      'Linear project team or recovery marker does not match. Review the project before publishing.',
    );
}

/** Persist verified metadata before publishing any issues into this project. */
async function saveLink(
  engine: Engine,
  projectId: string,
  state: TicketState,
  link: LinearProjectLink,
  remote: LinearProject,
): Promise<string> {
  state.linearProject = {
    ...link,
    id: remote.id,
    name: remote.name,
    state: 'linked',
    ...(remote.url ? { url: remote.url } : {}),
  };
  await writeTicketState(engine.store, projectId, state);
  return remote.id;
}
