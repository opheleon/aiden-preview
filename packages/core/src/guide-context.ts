import path from 'node:path';

import {
  helpLinks,
  type SetupFacts,
  type SetupProgress,
  setupProgress,
  type SetupState,
  SetupStateSchema,
} from '../../contracts/src/guide.js';
import type { Baseline, Project, RunManifest } from '../../contracts/src/index.js';
import { readCalls } from './calls.js';
import type { Engine } from './engine.js';
import { guideClarifications, guideRequirementsPending } from './guide-scope.js';
import { atomic, optionalJson, type Store } from './storage.js';
import { readTicketState } from './ticket-storage.js';
import { verificationAccessKeys } from './verification-access.js';
import { readAppUrl } from './verification-settings.js';
import { readVerification } from './verification-workflow.js';

/** Runs the Guide describes when asked about recent work, newest first. */
const recentRuns = 5;

/** Location of a project's setup facts. */
const setupFile = (store: Store, projectId: string): string =>
  path.join(store.project(projectId), 'setup.json');

/** A project's saved setup facts; a project that never started setup has none. */
export async function readSetupState(store: Store, projectId: string): Promise<SetupState> {
  return SetupStateSchema.parse((await optionalJson(setupFile(store, projectId))) ?? {});
}

/** Save setup facts after validating them. */
export async function writeSetupState(
  store: Store,
  projectId: string,
  state: SetupState,
): Promise<void> {
  await atomic(setupFile(store, projectId), SetupStateSchema.parse(state));
}

/** Everything the Guide knows about a project, all read from saved files. */
export type GuideFacts = {
  project: Project;
  baseline: Baseline | null;
  runs: RunManifest[];
  setup: SetupProgress;
  facts: SetupFacts;
};

/** Count actual checks of the current scope; an old empty result cannot finish setup. */
async function completedChecks(
  engine: Engine,
  runs: RunManifest[],
  baseline: Baseline | null,
): Promise<number> {
  const completed = runs.filter(
    (run) => run.status === 'completed' && run.baseline?.id === baseline?.id,
  );
  const checked = await Promise.all(
    completed.map(async (run) => {
      if (run.kind === 'report') return true;
      if (run.kind !== 'verify') return false;
      const saved = await readVerification(engine, run.projectId, run.id);
      return !!saved?.result.criteria.length;
    }),
  );
  return checked.filter(Boolean).length;
}

/**
 * Read the facts the setup checklist and the Guide prompt share. Settings come from the public
 * view, so test credentials never reach the Guide.
 */
export async function guideFacts(engine: Engine, projectId: string): Promise<GuideFacts> {
  const { project, baseline, runs } = await engine.state(projectId);
  if (!project) throw new Error('This project is not saved yet.');
  const settings = await readAppUrl(engine, projectId);
  const tickets = await readTicketState(engine.store, projectId).catch(() => null);
  const state = await readSetupState(engine.store, projectId);
  const keys = verificationAccessKeys(settings);
  const facts: SetupFacts = {
    baselineId: baseline?.id ?? null,
    clarificationCount: (await guideClarifications(engine, projectId)).length,
    requirementsPending: await guideRequirementsPending(engine, projectId, baseline),
    state,
    readyMethods: [
      'code',
      'manual',
      ...(['web', 'api'] as const).filter(
        (method) => !!keys[method] && state.verifiedTargets?.[method] === keys[method],
      ),
    ],
    repositories: project.repositories.length,
    url: settings.url,
    api: !!settings.api,
    phone: false,
    manual: !!settings.manual,
    completedChecks: await completedChecks(engine, runs, baseline),
    trackerLinked: !!tickets?.settings?.enabled,
  };
  return { project, baseline, runs, setup: setupProgress(facts), facts };
}

/** One recent run in plain fields the Guide can quote. */
function runSummary(run: RunManifest): Record<string, unknown> {
  const names = {
    prepare: 'requirements',
    report: 'code check',
    estimate: 'sizing',
    verify: 'app check',
  };
  return {
    kind: names[run.kind],
    status: run.status,
    startedAt: run.createdAt,
    startedBecause: run.reason ?? null,
    error: run.error ?? null,
    checkedUrl: run.verifyUrl ?? null,
    requirementsChecked: run.baseline?.product.requirements.map((r) => r.id) ?? [],
  };
}

/** The latest code-check summary, when one finished. */
async function latestReport(engine: Engine, projectId: string): Promise<unknown> {
  const latest = await optionalJson<{ id: string }>(
    path.join(engine.store.project(projectId), 'latest.json'),
  );
  if (!latest) return null;
  const report = await engine.getReport(projectId, latest.id).catch(() => null);
  return (
    report && {
      generatedAt: report.generatedAt,
      summary: report.summary,
      statuses: report.assessments.map((a) => ({
        requirementId: a.requirementId,
        status: a.status,
      })),
    }
  );
}

/**
 * Build the Guide's input: the project, its requirements, how it is checked, recent runs, open
 * calls, setup progress, and where to get help. Everything here is evidence, never instructions.
 */
export async function guideInput(
  engine: Engine,
  facts: GuideFacts,
): Promise<Record<string, unknown>> {
  const { project, baseline, runs, setup } = facts;
  const settings = await readAppUrl(engine, project.id);
  const calls = await readCalls(engine.store, project.id).catch(() => []);
  return {
    project: {
      name: project.name,
      intent: project.context.slice(0, 6000),
      folder: project.rootPath ?? null,
      repositories: project.repositories.map((r) => ({ id: r.id, notes: r.notes })),
      runtime: { provider: project.runtime.provider, auth: project.runtime.auth },
    },
    requirements: baseline?.product.requirements.map((r) => ({ id: r.id, text: r.text })) ?? null,
    overview: baseline?.product.overview ?? null,
    deliveryPlan: baseline?.product.deliveryPlan ?? null,
    verification: {
      webUrl: settings.url,
      apiUrl: settings.api?.url ?? null,
      apiAllowsWrites: settings.api?.allowMutations ?? null,
      iphone: false,
      manual: !!settings.manual,
      runsAfterCodeCheck: settings.trigger === 'after_assessment',
    },
    setup: setup.steps.map((s) => ({ step: s.id, status: s.status, detail: s.detail })),
    nextSetupStep: setup.next,
    recentRuns: runs.slice(0, recentRuns).map(runSummary),
    latestCodeCheck: await latestReport(engine, project.id),
    openCalls: calls
      .filter((c) => c.status === 'open')
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        question: c.question,
        options: c.options,
        selectionMode: c.selectionMode ?? 'single',
        blocking: c.kind === 'decision' && c.blocking !== false,
        requirementId: c.requirementId,
      })),
    requirementsPending: facts.facts.requirementsPending,
    help: {
      slack: helpLinks.slack,
      inApp:
        'Help / Getting started in the sidebar has Getting started, Daily workflow, and Troubleshooting.',
      settings:
        'Settings > Projects holds the folder, verification, ticket, and schedule settings.',
    },
  };
}
