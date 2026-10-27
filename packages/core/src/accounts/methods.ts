import { z } from 'zod/v3';

import type { AccountTask, NewAccountTask } from '../../../contracts/src/accounts-api.js';
import type { WorkerMethod, WorkerResult } from '../../../contracts/src/api.js';
import { ProjectSchema } from '../../../contracts/src/index.js';
import { scopeName } from '../../../contracts/src/project-name.js';
import { teamsAuth } from '../../../contracts/src/teams-auth.js';
import type { Runtimes } from '../../../runtimes/src/index.js';
import type { Engine } from '../engine.js';
import { readProject } from '../engine-queries.js';
import { AccountAgent, deviceName } from './agent.js';
import { AccountsClient, AccountsError, accountsUrl, dashboardUrl } from './client.js';
import { documentFor, localDocument, materialize } from './documents.js';
import { InventoryProbe } from './inventory.js';
import { TeamsSignIn } from './oidc.js';
import { AccountSession } from './session.js';
import { syncSetupTasks } from './setup-tasks.js';

/** Worker operations the Teams tier owns. */
type AccountMethod = Extract<
  WorkerMethod,
  | 'accountStatus'
  | 'accountSignIn'
  | 'accountSignOut'
  | 'accountState'
  | 'accountTakeTask'
  | 'accountFinishTask'
  | 'accountSetPickup'
  | 'accountCreateProject'
  | 'accountShareProject'
  | 'accountPoll'
  | 'accountSyncSetup'
  | 'accountCancelTask'
  | 'accountRetryTask'
>;

/** Validate unknown worker inputs before dispatching a typed account operation. */
function operation<T>(
  schema: z.ZodType<T>,
  call: (params: T) => unknown,
): (params: unknown) => unknown {
  return Object.assign((params: unknown) => call(schema.parse(params)), {
    validate: (params: unknown) => {
      schema.parse(params);
    },
  });
}

const none = z.object({}).strict();
const account = z.object({ accountId: z.string().min(1).max(64) }).strict();
const task = z.object({ taskId: z.string().min(1).max(64) }).strict();
const teamProject = account.extend({ projectId: z.string().min(1).max(64) }).strict();

/** The first task of every account project: the same requirements step the solo app starts with. */
const writeRequirements: NewAccountTask = {
  actor: 'agent',
  kind: 'write-requirements',
  title: 'Write requirements',
  instructions: 'Turn the goal into requirements.',
  usesModel: true,
};

/**
 * Why a signed-in person cannot use Teams on this machine, or null when they can. Teams are
 * bought or joined in the dashboard, so an email that is on no team is not signed in here.
 */
function notOnTeam(email: string, accounts: unknown[]): string | null {
  if (accounts.length) return null;
  return `${email} is not on an Aiden Teams team. Accept your team's invitation in the Teams dashboard, or sign in with the email your team invited.`;
}

/**
 * Keep a browser sign-in only for someone already on a team: the reason to refuse it, or null.
 * The server itself refuses an email it has never seen, with a reason to show.
 */
async function admission(client: AccountsClient): Promise<string | null> {
  try {
    const me = await client.me();
    return notOnTeam(me.user.email, me.accounts);
  } catch (error) {
    if (error instanceof AccountsError && error.status === 403) return error.message;
    throw error;
  }
}

/**
 * Queue a stopped or failed Aiden task again as a new task with the same work; the old one stays
 * in the history as it ended.
 */
async function retry(client: AccountsClient, taskId: string): Promise<AccountTask> {
  const old = await client.task(taskId);
  return client.enqueue(old.projectId, {
    actor: 'agent',
    kind: old.kind,
    title: old.title,
    instructions: old.instructions,
    requirementIds: old.requirementIds,
    tools: old.requires.tools,
    connections: old.requires.connections,
    usesModel: old.requires.runtime !== null,
  });
}

/** Wire the Teams tier into the worker. Signed out, every method answers without touching the network. */
export function accountMethods(
  engine: Engine,
  runtimes: Pick<Runtimes, 'diagnostics'>,
): Record<AccountMethod, (params: unknown) => unknown> {
  let built: Context | undefined;
  /** Build the session, sign-in, client, and agent on first use, so solo use never touches any of it. */
  const context = (): Context => {
    if (built) return built;
    const session = new AccountSession(engine.store);
    const signIn = new TeamsSignIn(teamsAuth(process.env), session);
    const client = new AccountsClient(
      accountsUrl(),
      () => signIn.accessToken(),
      fetch,
      () => signIn.invalidate(),
    );
    signIn.admit = () => admission(client);
    const inventory = new InventoryProbe({
      diagnostics: () => runtimes.diagnostics({ usage: true }),
      connections: () => engine.integrations.list(),
    });
    built = {
      session,
      signIn,
      client,
      agent: new AccountAgent(engine, session, client, inventory),
    };
    return built;
  };
  // Desktop tests follow the team admins' allowed app publishers whenever this machine is signed in.
  engine.desktops.teamPublishers = async () => {
    const { session, client } = context();
    if (!(await session.refreshToken())) return null;
    return (await client.me()).accounts.flatMap((team) => team.allowedPublishers ?? []);
  };
  return {
    accountStatus: operation(none, () => status(context())),
    accountSignIn: operation(none, () => context().signIn.begin()),
    accountSignOut: operation(none, async () => {
      await context().signIn.signOut();
      return null;
    }),
    accountState: operation(account, (p) => syncState(engine, context().client, p.accountId)),
    accountTakeTask: operation(task, (p) => context().client.take(p.taskId)),
    accountFinishTask: operation(
      task.extend({ answer: z.string().trim().max(5000).optional() }).strict(),
      (p) => context().client.done(p.taskId, p.answer ?? null),
    ),
    accountSetPickup: operation(
      z
        .object({
          pickupEnabled: z.boolean().optional(),
          usageCapPct: z.number().int().min(10).max(100).optional(),
        })
        .strict(),
      async (p) => {
        await context().session.update({
          ...(p.pickupEnabled === undefined ? {} : { pickupEnabled: p.pickupEnabled }),
          ...(p.usageCapPct === undefined ? {} : { usageCapPct: p.usageCapPct }),
        });
        return status(context());
      },
    ),
    accountCreateProject: operation(
      account.extend({ project: ProjectSchema }).strict(),
      async (p) => {
        const created = await context().client.createProject({
          accountId: p.accountId,
          name: scopeName(p.project.context),
          runtime: p.project.runtime,
          document: documentFor(p.project, null),
          tasks: [writeRequirements],
        });
        await materialize(engine, created.project, true);
        return readProject(engine.store, created.project.id);
      },
    ),
    accountShareProject: operation(teamProject, (p) => shareProject(engine, context().client, p)),
    accountCancelTask: operation(task, async (p) => {
      const stopped = await context().client.cancel(p.taskId);
      // If this machine is the one running it, stop now rather than at the next heartbeat.
      await context().agent.stop(p.taskId);
      return stopped;
    }),
    accountRetryTask: operation(task, (p) => retry(context().client, p.taskId)),
    accountSyncSetup: operation(
      z.object({ projectId: z.string().min(1).max(64) }).strict(),
      async (p) => {
        await context().agent.share(p.projectId);
        await syncSetupTasks(engine, context().client, p.projectId);
        return null;
      },
    ),
    accountPoll: operation(
      z
        .object({ idleSeconds: z.number().min(0), onBattery: z.boolean(), busy: z.boolean() })
        .strict(),
      (p) => context().agent.poll(p),
    ),
  };
}

/** Everything the account methods share, built on first use. */
interface Context {
  session: AccountSession;
  signIn: TeamsSignIn;
  client: AccountsClient;
  agent: AccountAgent;
}

/** Sign-in state, accounts, and this machine's strip. A rejected session is cleared locally. */
async function status({
  session,
  signIn,
  client,
  agent,
}: Context): Promise<WorkerResult<'accountStatus'>> {
  const preferences = await session.preferences();
  const machine = {
    ...agent.status(),
    settingsUrl: dashboardUrl(),
    deviceName: deviceName(),
    pickupEnabled: preferences.pickupEnabled,
    usageCapPct: preferences.usageCapPct,
    signingIn: signIn.progress().waiting,
  };
  if (!(await session.refreshToken()))
    return {
      signedIn: false,
      email: null,
      userId: null,
      accounts: [],
      message: signIn.progress().failure,
      ...machine,
    };
  try {
    const me = await client.me();
    // A sign-in kept from before this rule, on an email with no team, ends here with the reason.
    const refused = notOnTeam(me.user.email, me.accounts);
    if (refused) {
      await signIn.signOut();
      return {
        signedIn: false,
        email: null,
        userId: null,
        accounts: [],
        message: refused,
        ...machine,
      };
    }
    await session.rememberUser(me.user);
    return {
      signedIn: true,
      email: me.user.email,
      profile: { name: me.user.name, avatar: me.user.avatar ?? null },
      userId: me.user.id,
      accounts: me.accounts.map(({ id, name }) => ({ id, name })),
      message: null,
      ...machine,
    };
  } catch (error) {
    if (error instanceof AccountsError && error.status === 401) {
      await session.signOut();
      return {
        signedIn: false,
        email: null,
        userId: null,
        accounts: [],
        message: error.message,
        ...machine,
      };
    }
    const message =
      error instanceof AccountsError ? error.message : 'Aiden could not reach your account.';
    return {
      signedIn: true,
      email: preferences.email ?? null,
      userId: preferences.userId ?? null,
      accounts: [],
      message,
      ...machine,
    };
  }
}

/** Read the account view and bring this machine's copies of its projects up to the server's revision. */
async function syncState(
  engine: Engine,
  client: AccountsClient,
  accountId: string,
): Promise<WorkerResult<'accountState'>> {
  const state = await client.state(accountId);
  for (const project of state.projects) {
    if (project.status !== 'active') continue;
    const local = await readProject(engine.store, project.id);
    if (local?.account && local.account.revision >= project.revision) continue;
    await materialize(engine, await client.project(project.id));
  }
  return state;
}

/**
 * Move a project made on this computer into the team. It keeps its id, so its runs, answers, and
 * history stay as they are; the team gets its project and requirements, and the next step is
 * queued. A project without requirements yet gets the team's Write requirements task.
 * Example: a project started before signing in shows up on the Teams board after this.
 */
export async function shareProject(
  engine: Engine,
  client: AccountsClient,
  { accountId, projectId }: z.infer<typeof teamProject>,
): Promise<WorkerResult<'accountShareProject'>> {
  const { project, baseline } = await localDocument(engine, projectId);
  if (project.account) throw new Error('This project is already in your team.');
  if (engine.isBusy(projectId))
    throw new Error('Aiden is working on this project. Sync it to your team when it finishes.');
  const created = await client.createProject({
    id: projectId,
    accountId,
    name: scopeName(project.context, baseline?.product).slice(0, 200),
    runtime: project.runtime,
    document: documentFor(project, baseline),
    tasks: baseline ? [] : [writeRequirements],
  });
  await materialize(engine, created.project, true);
  if (baseline) await syncSetupTasks(engine, client, projectId);
  return readProject(engine.store, projectId);
}
