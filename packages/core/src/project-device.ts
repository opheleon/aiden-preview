import path from 'node:path';

import type { DeviceSource, ProjectDeviceTest } from '../../contracts/src/device-verification.js';
import type { RunManifest } from '../../contracts/src/index.js';
import { appendActivity } from './activity.js';
import { blockedRequirements } from './blockers.js';
import type { Engine } from './engine.js';
import { requireOpenProject } from './project-lifecycle.js';
import { acquireProjectLock } from './run-lifecycle.js';
import { atomic } from './storage.js';
import { checkItems } from './triage.js';

/**
 * Follow a completed code assessment with an explicitly requested phone check. The worker derives
 * criteria and provenance from the accepted report, while the UI reviewer sees only app evidence.
 * A missing phone or inconclusive test preserves code findings and remaining-work estimation.
 */
export async function verifyProjectDevice(
  engine: Engine,
  run: RunManifest,
  config: ProjectDeviceTest,
): Promise<void> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireProjectLock(engine.store, run.projectId);
    await requireOpenProject(engine.store, run.projectId);
    const report = await engine.getReport(run.projectId, run.id);
    const state = await engine.state(run.projectId);
    if (state.baseline?.id !== report.baselineId)
      throw new Error('The assessment baseline changed before phone verification.');
    const blockers = await blockedRequirements(engine.store, run.projectId, report.baseline);
    const items = checkItems(report.baseline).filter(
      (item) => !blockers.get(item.requirementId)?.length,
    );
    const excluded = checkItems(report.baseline).length - items.length;
    if (excluded)
      await appendActivity(engine, run, {
        kind: 'check',
        summary: `${excluded} phone checks deferred because their requirements have unresolved decisions.`,
      });
    if (!items.length) {
      await appendActivity(engine, run, {
        kind: 'result',
        summary: 'No unblocked requirements to check on the phone.',
      });
      return;
    }
    const source: DeviceSource = {
      projectId: run.projectId,
      reportId: report.id,
      baselineId: report.baselineId,
      snapshots: report.snapshots.map(({ repositoryId, sha }) => ({ repositoryId, sha })),
      checks: items.map((item) => {
        const assessment = report.assessments.find((a) => a.requirementId === item.requirementId);
        return {
          requirementId: item.requirementId,
          edgeCaseId: item.edgeCaseId,
          codeStatus: assessment?.status ?? 'unknown',
          codeExplanation: assessment?.explanation ?? 'No code assessment available.',
        };
      }),
    };
    const started = await engine.devices.start(
      {
        ...config,
        name: run.project.name,
        runtime: run.project.runtime,
        criteria: items.map((item) =>
          item.edgeCaseId ? `${item.requirement}\nEdge case: ${item.text}` : item.text,
        ),
      },
      source,
    );
    await appendActivity(engine, run, {
      kind: 'check',
      summary: `Code assessment accepted. Checking ${items.length} requirements and edge cases on the installed iPhone build ${config.buildLabel}.`,
    });
    await engine.devices.wait(started.runId);
    const result = await engine.devices.read(started.runId);
    if (!result) throw new Error('Phone evidence is unavailable.');
    await atomic(
      path.join(engine.store.project(run.projectId), 'latest-device-verification.json'),
      {
        runId: result.id,
        reportId: report.id,
        baselineId: report.baselineId,
        status: result.status,
      },
    );
    for (const [index, criterion] of result.criteria.entries()) {
      const check = source.checks[index]!;
      await appendActivity(engine, run, {
        kind: 'result',
        requirementId: check.requirementId,
        ...(check.edgeCaseId ? { edgeCaseId: check.edgeCaseId } : {}),
        summary: `Code: ${check.codeStatus}. Installed app: ${criterion.verdict}.`,
        reason: criterion.explanation,
      });
    }
    await appendActivity(engine, run, {
      kind: 'result',
      summary: `Phone check ${result.status}: ${result.message}`,
    });
  } catch {
    await appendActivity(engine, run, {
      kind: 'result',
      summary: 'Phone verification could not finish. Code assessment is preserved.',
      reason:
        'Check the phone connection and provider, resolve project decisions, and rerun the assessment with the installed build. Device testing supports up to 200 criteria.',
    });
  } finally {
    await release?.();
  }
}
