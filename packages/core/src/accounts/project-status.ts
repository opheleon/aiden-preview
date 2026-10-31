import type { AccountState } from '../../../contracts/src/accounts-api.js';
import type { Engine } from '../engine.js';
import { readProject } from '../engine-queries.js';
import { decideProject, readLifecycle } from '../project-lifecycle.js';
import type { AccountsClient } from './client.js';

/**
 * Bring each team project's closed or open status in line between the team and this computer,
 * keeping whichever decision is newer. Returns the team's projects with any status this computer
 * just sent. Example: a project closed here while offline closes for the team at the next Work
 * refresh; a project a teammate closed since closes here too, and nothing is deleted either way.
 * @param engine The engine whose project folders hold this computer's decisions.
 * @param client The signed-in team client.
 * @param projects The team's projects from its latest state.
 */
export async function reconcileProjectStatus(
  engine: Engine,
  client: AccountsClient,
  projects: AccountState['projects'],
): Promise<AccountState['projects']> {
  const settled: AccountState['projects'] = [];
  for (const project of projects) {
    const local = await readProject(engine.store, project.id);
    const here = local?.lifecycle?.status ?? 'active';
    if (!local?.account || here === project.status) {
      settled.push(project);
      continue;
    }
    const decided = (await readLifecycle(engine.store, project.id)).history
      .filter((entry) => entry.action !== 'accepted')
      .at(-1)?.at;
    const team = await client.project(project.id);
    if (decided && Date.parse(decided) > Date.parse(team.updatedAt)) {
      const sent = await sendProjectStatus(client, project.id, here);
      settled.push(sent ? { ...project, status: here } : project);
      continue;
    }
    // A teammate decided last. A coding job running here keeps this computer as it is for now.
    await decideProject(engine, project.id, {
      action: project.status === 'closed' ? 'closed' : 'reopened',
      note: project.status === 'closed' ? 'Closed by your team.' : 'Reopened by your team.',
    }).catch(() => undefined);
    settled.push(project);
  }
  return settled;
}

/**
 * Close or reopen a team project for the whole team. A team server without project status yet
 * refuses it; the decision stays on this computer and the next Work refresh tries again.
 * Returns whether the team took it.
 * @param client The signed-in team client.
 * @param projectId The team project.
 * @param status Its new status.
 */
export async function sendProjectStatus(
  client: AccountsClient,
  projectId: string,
  status: 'active' | 'closed',
): Promise<boolean> {
  return client.setProjectStatus(projectId, status).then(
    () => true,
    () => false,
  );
}
