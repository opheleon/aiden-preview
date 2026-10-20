import type { GuideCheckResult } from '../../contracts/src/guide.js';
import type { RunManifest } from '../../contracts/src/index.js';
import type { Engine } from './engine.js';
import { readVerification } from './verification-workflow.js';

/** Longest label a saved result keeps, matching the thread contract. */
const maxLabel = 400;
/** Most items a saved result keeps, matching the thread contract. */
const maxItems = 50;

/** Bound one label to the contract so a long requirement never invalidates the thread. */
function label(text: string): string {
  const clean = text.trim() || '(no description)';
  return clean.length > maxLabel ? `${clean.slice(0, maxLabel - 3)}...` : clean;
}

/** What a finished check announces in the thread: one line and, when readable, its results. */
export interface CheckAnnouncement {
  text: string;
  result?: GuideCheckResult;
}

/**
 * Describe a finished check for the conversation, with a saved copy of its per-requirement results
 * so they stay in the thread after later checks or scope changes. An unreadable report still
 * announces the check, without results.
 * Example: a code check with two of three requirements implemented reads "Code check finished: 2
 * of 3 requirements met." and saves one passed or failed item per requirement.
 */
export async function checkAnnouncement(
  engine: Engine,
  run: RunManifest,
): Promise<CheckAnnouncement> {
  if (run.kind === 'verify') {
    const check = await readVerification(engine, run.projectId, run.id).catch(() => null);
    if (!check) return { text: 'App check finished. Open the run to see its results.' };
    if (!check.result.summary.total)
      return {
        text: 'No requirements were checked. Resolve the questions in this chat before trying again.',
      };
    return {
      text: `App check finished. ${check.result.summary.line}`,
      result: {
        kind: 'app',
        runId: run.id,
        items: check.result.criteria.slice(0, maxItems).map((criterion) => ({
          requirementId: criterion.requirementId,
          label: label(criterion.criterion),
          status:
            criterion.verdict === 'pass'
              ? 'passed'
              : criterion.verdict === 'fail'
                ? 'failed'
                : 'unverified',
        })),
      },
    };
  }
  const report = await engine.getReport(run.projectId, run.id).catch(() => null);
  if (!report) return { text: 'Code check finished.' };
  const met = report.assessments.filter((a) => a.status === 'implemented').length;
  return {
    text: `Code check finished: ${met} of ${report.assessments.length} requirements met.`,
    result: {
      kind: 'code',
      runId: run.id,
      items: report.assessments.slice(0, maxItems).map((assessment) => ({
        requirementId: assessment.requirementId,
        label: label(
          report.baseline.requirements.find((r) => r.id === assessment.requirementId)?.text ??
            assessment.requirementId,
        ),
        status:
          assessment.status === 'implemented'
            ? 'passed'
            : assessment.status === 'unknown'
              ? 'unverified'
              : 'failed',
      })),
    },
  };
}
