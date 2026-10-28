import type { DeliveryFeature } from '../../../contracts/src/delivery-plan.js';
import type { Baseline, Project, Report } from '../../../contracts/src/index.js';
import type { Engine } from '../engine.js';
import type { AccountsClient } from './client.js';
import { teamsDebug } from './debug.js';

/** Instruction line naming the repositories a build task works in. */
const repositoriesLine = /^Repositories: (.+)$/m;

/**
 * The GitHub repositories a build task works in, from its instructions.
 * Example: "Repositories: acme/api, acme/ui" gives ["acme/api", "acme/ui"].
 * @param instructions The build task's instructions.
 */
export function buildRepositories(instructions: string): string[] {
  return (repositoriesLine.exec(instructions)?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** A requirement the code check found partly or not implemented. */
type Gap = Report['assessments'][number];

/** The handoff for one feature slice: what it is, where it may change code, and what is left. */
function instructionsFor(
  feature: Pick<DeliveryFeature, 'id' | 'title'> & Partial<DeliveryFeature>,
  gaps: Gap[],
  baseline: Baseline,
  repositories: string[],
): string {
  /** A requirement's wording, so Claude Code reads what was agreed. */
  const text = (id: string) =>
    baseline.product.requirements.find((requirement) => requirement.id === id)?.text ?? id;
  const work = gaps
    .map((gap) =>
      [
        `${gap.requirementId}: ${text(gap.requirementId)}`,
        ...gap.remainingWork.map((item) => `- ${item}`),
      ].join('\n'),
    )
    .join('\n\n');
  return [
    `Feature: ${feature.title}`,
    `Repositories: ${repositories.join(', ')}`,
    feature.outcome ? `Outcome: ${feature.outcome}` : '',
    feature.dependsOn?.length
      ? `Builds on ${feature.dependsOn.join(', ')}, which may be built at the same time; keep changes compatible.`
      : '',
    `Implement the remaining work for these requirements as one vertical slice, in whichever of the repositories it needs:\n\n${work}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
}

/**
 * Once a team project's setup is complete, hand what the code check found missing to the project's
 * coding agent (Claude Code or Codex, as its model is set) as vertical slices: one build task per delivery-plan feature with unfinished requirements. Each
 * task can change every repository the feature needs and ends with one PR per changed repository,
 * and separate features can go to separate machines at the same time. Without a delivery plan,
 * everything missing is one slice. Queued once per version of the requirements and feature.
 * Example: "F-2 Manage private events" and "F-4 Sign in from the web app" go on the queue together.
 * @param engine The local engine holding the latest code check.
 * @param client The Teams API client.
 * @param project The team project with its repositories.
 * @param baseline The requirements the code check assessed, with their delivery plan.
 */
export async function queueBuild(
  engine: Engine,
  client: AccountsClient,
  project: Project,
  baseline: Baseline,
): Promise<void> {
  const report = await engine.getReport(project.id).catch(() => null);
  if (!report) return;
  const gaps = report.assessments.filter((a) => a.status === 'partial' || a.status === 'missing');
  const repositories = project.repositories.flatMap((repo) =>
    repo.source?.kind === 'github' ? [repo.source.name] : [],
  );
  const features = baseline.product.deliveryPlan ?? [
    {
      id: 'all',
      title: 'Remaining requirements',
      requirementIds: gaps.map((g) => g.requirementId),
    },
  ];
  teamsDebug('build-check', {
    projectId: project.id,
    gaps: gaps.map((gap) => gap.requirementId),
    repositories,
  });
  for (const feature of features) {
    const mine = gaps.filter((gap) => feature.requirementIds.includes(gap.requirementId));
    if (!mine.length || !repositories.length) continue;
    await client.enqueue(project.id, {
      actor: 'agent',
      kind: 'build',
      title: `Build: ${feature.title}`.slice(0, 200),
      instructions: instructionsFor(feature, mine, baseline, repositories),
      requirementIds: mine.map((gap) => gap.requirementId),
      // Only machines with the project's own coding agent, signed in with its exact billing mode
      // and under the member's usage cap, may take a build.
      tools: ['git', 'gh', project.runtime.provider],
      usesModel: true,
      dedupeKey: `build:${project.id}:${baseline.id}:${feature.id}`,
    });
  }
}
