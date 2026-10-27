import type { z } from 'zod/v3';

import {
  type AccountProject,
  AccountProjectSchema,
  type AccountState,
  AccountStateSchema,
  type AccountTask,
  AccountTaskSchema,
  ApiErrorSchema,
  type Me,
  MeSchema,
  type NewAccountTask,
  type ProjectCreated,
  ProjectCreatedSchema,
  type WakeHook,
  WakeHookSchema,
  type WorkAnswer,
  WorkAnswerSchema,
} from '../../../contracts/src/accounts-api.js';
import type { AgentStatus, DeliveryCheckpoint } from '../../../contracts/src/accounts-execution.js';
import { flavorFromEnv } from '../../../contracts/src/app-flavor.js';
import { responseSummary, teamsDebug } from './debug.js';

/**
 * Where the Accounts API lives unless AIDEN_ACCOUNTS_URL points elsewhere (local development).
 * Aiden Beta (`AIDEN_FLAVOR=beta`) uses the beta server.
 */
const defaultUrl = 'https://api.opheleon.ai';
const betaUrl = 'https://api-beta.opheleon.ai';
/** No Accounts call should hold up the app for long. */
const timeoutMs = 15_000;

/** An Accounts API failure with the server's stable code and caller-safe message. */
export class AccountsError extends Error {
  /**
   * Wrap a failed response.
   * @param status HTTP status, or 0 when the server could not be reached.
   * @param code Stable error code from the server.
   * @param message Plain-language explanation safe to show.
   */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccountsError';
  }
}

/** The API base URL: HTTPS, or plain HTTP only for this machine during development. */
export function accountsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(
    env.AIDEN_ACCOUNTS_URL || (flavorFromEnv(env) === 'beta' ? betaUrl : defaultUrl),
  );
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('The Accounts server must use HTTPS.');
  return url.origin;
}

/**
 * The Teams dashboard's address, where teams, invitations, admins, billing and profiles are
 * managed. AIDEN_DASHBOARD_URL wins; otherwise the API host's first label `api` or `api-<stage>`
 * becomes `app` or `app-<stage>` (sibling subdomains), and any other API address is used as is.
 * Examples: https://api.opheleon.ai gives https://app.opheleon.ai, and
 * https://api-beta.opheleon.ai gives https://app-beta.opheleon.ai.
 */
export function dashboardUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AIDEN_DASHBOARD_URL) return new URL(env.AIDEN_DASHBOARD_URL).origin;
  const api = new URL(accountsUrl(env));
  api.hostname = api.hostname.replace(/^api(-[a-z0-9]+)?\./, 'app$1.');
  return api.origin;
}

/** Typed calls to the Accounts API. The session token is sent as a bearer token and never logged. */
export class AccountsClient {
  /**
   * Create a client.
   * @param base API origin from `accountsUrl`.
   * @param token Reads a current access token.
   * @param http Fetch implementation, injectable for tests.
   * @param rejected Called when the server rejects a token, so the next attempt refreshes it.
   */
  constructor(
    private readonly base: string,
    private readonly token: () => Promise<string | undefined>,
    private readonly http: typeof fetch = fetch,
    private readonly rejected: () => void = () => {},
  ) {}

  /** Send one request; a rejected token is refreshed and the request tried once more. */
  private async call<T>(
    method: string,
    route: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    try {
      return await this.send(method, route, schema, body);
    } catch (error) {
      if (!(error instanceof AccountsError) || error.status !== 401) throw error;
      this.rejected();
      return this.send(method, route, schema, body);
    }
  }

  /** Send one request and validate the response against the vendored contract. */
  private async send<T>(
    method: string,
    route: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const token = await this.token();
    const started = Date.now();
    let response: Response;
    try {
      response = await this.http(`${this.base}/api/v1${route}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      teamsDebug('api', { method, route, status: 0, ms: Date.now() - started });
      throw new AccountsError(
        0,
        'unreachable',
        'Aiden could not reach your account. Check your connection.',
      );
    }
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : null;
    teamsDebug('api', {
      method,
      route,
      status: response.status,
      ms: Date.now() - started,
      summary: responseSummary(json),
    });
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(json);
      throw new AccountsError(
        response.status,
        error.success ? error.data.error : 'unexpected',
        error.success ? error.data.message : `The account server answered ${response.status}.`,
      );
    }
    return schema.parse(json);
  }

  /** The signed-in person and their accounts. */
  me(): Promise<Me> {
    return this.call('GET', '/me', MeSchema);
  }

  /** The shared work view for one account. */
  state(accountId: string): Promise<AccountState> {
    return this.call('GET', `/accounts/${encodeURIComponent(accountId)}/state`, AccountStateSchema);
  }

  /** Create a project and queue its first tasks. */
  createProject(input: {
    /** Kept when a project made on this computer moves into the team. */
    id?: string;
    accountId: string;
    name: string;
    runtime: unknown;
    document: unknown;
    tasks: NewAccountTask[];
  }): Promise<ProjectCreated> {
    return this.call('POST', '/projects', ProjectCreatedSchema, input);
  }

  /** Read one project with its document. */
  project(projectId: string): Promise<AccountProject> {
    return this.call('GET', `/projects/${encodeURIComponent(projectId)}`, AccountProjectSchema);
  }

  /** Replace a project document if nobody else wrote since `revision`. */
  replaceDocument(
    projectId: string,
    revision: number,
    document: unknown,
    name?: string,
  ): Promise<AccountProject> {
    return this.call(
      'PUT',
      `/projects/${encodeURIComponent(projectId)}/document`,
      AccountProjectSchema,
      { revision, document, ...(name ? { name } : {}) },
    );
  }

  /** Ask what this machine should do next, sending its telemetry. */
  next(body: { deviceId: string; deviceName: string; sample: unknown }): Promise<WorkAnswer> {
    return this.call('POST', '/work/next', WorkAnswerSchema, { ...body, executionProtocol: 1 });
  }

  /**
   * Tell the team where to wake this machine when it sleeps between tasks, with the key it checks
   * wake requests against; a null address stops the wakes. The key is sent once and never logged.
   */
  wake(body: {
    deviceId: string;
    url: string | null;
    secret?: string | undefined;
  }): Promise<WakeHook> {
    return this.call('PUT', '/work/wake', WakeHookSchema, body);
  }

  /** Extend the lease and report progress. */
  heartbeat(
    taskId: string,
    body: {
      deviceId: string;
      attemptId: string;
      activitySequence: number;
      deviceName: string;
      sample: unknown;
      messages: string[];
    },
  ): Promise<AccountTask> {
    return this.call(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/heartbeat`,
      AccountTaskSchema,
      body,
    );
  }

  /** Finish an agent task. */
  complete(
    taskId: string,
    body: {
      deviceId: string;
      attemptId: string;
      result: unknown;
      followUps: NewAccountTask[];
      outcome: unknown;
    },
  ): Promise<AccountTask> {
    return this.call(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/complete`,
      AccountTaskSchema,
      body,
    );
  }

  /** Report a failed attempt. */
  fail(
    taskId: string,
    body: { deviceId: string; attemptId: string; error: string; outcome: unknown },
  ): Promise<AccountTask> {
    return this.call('POST', `/tasks/${encodeURIComponent(taskId)}/fail`, AccountTaskSchema, body);
  }

  /** Confirm the server still authorizes this exact launch before work or publication. */
  authorize(taskId: string, body: { deviceId: string; attemptId: string }): Promise<AccountTask> {
    return this.call(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/authorize`,
      AccountTaskSchema,
      body,
    );
  }

  /** Persist committed publication metadata before pushing branches or creating PRs. */
  checkpoint(
    taskId: string,
    body: { deviceId: string; attemptId: string; checkpoint: DeliveryCheckpoint },
  ): Promise<AccountTask> {
    return this.call(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/checkpoint`,
      AccountTaskSchema,
      body,
    );
  }

  /** Send a status report with rotating OAuth credentials, never exposed to the coding agent. */
  reportStatus(
    taskId: string,
    body: AgentStatus & { deviceId: string; attemptId: string; sequence: number },
  ): Promise<AccountTask> {
    return this.call(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/status`,
      AccountTaskSchema,
      body,
    );
  }

  /** Park the attempt behind an assigned human question without waiting inside the agent. */
  needsHuman(
    taskId: string,
    body: { deviceId: string; attemptId: string; title: string; question: string },
  ): Promise<AccountTask> {
    return this.call(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/needs-human`,
      AccountTaskSchema,
      body,
    );
  }

  /** Add a task to a project's queue; a repeated dedupe key returns the existing task. */
  enqueue(projectId: string, task: NewAccountTask): Promise<AccountTask> {
    return this.call('POST', '/tasks', AccountTaskSchema, { projectId, task });
  }

  /** One task as the team sees it. */
  task(taskId: string): Promise<AccountTask> {
    return this.call('GET', `/tasks/${encodeURIComponent(taskId)}`, AccountTaskSchema);
  }

  /** Stop an unfinished task for the whole team. */
  cancel(taskId: string): Promise<AccountTask> {
    return this.call('POST', `/tasks/${encodeURIComponent(taskId)}/cancel`, AccountTaskSchema);
  }

  /** Claim a human task. */
  take(taskId: string): Promise<AccountTask> {
    return this.call('POST', `/tasks/${encodeURIComponent(taskId)}/take`, AccountTaskSchema);
  }

  /** Finish a human task with an optional answer. */
  done(taskId: string, answer: unknown): Promise<AccountTask> {
    return this.call('POST', `/tasks/${encodeURIComponent(taskId)}/done`, AccountTaskSchema, {
      answer,
    });
  }
}
