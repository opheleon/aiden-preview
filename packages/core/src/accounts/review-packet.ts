import type {
  CheckInput,
  NewAccountTask,
  ReviewPacket,
} from '../../../contracts/src/accounts-api.js';
import type { CodingJob } from '../../../contracts/src/index.js';
import type { QuestionScope, WorkRole } from '../../../contracts/src/work-roles.js';
import type { RequirementVerdict } from '../team-coding.js';

/** Server limits on a review packet. */
const limits = { summary: 8000, pullRequests: 20, checks: 50, name: 200, detail: 500 } as const;

/** A GitHub pull request URL, exactly as Aiden opens and reports them. */
const pullRequestUrl = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)$/;

/**
 * The CI check name for one pull request, or null when the URL is not a GitHub pull request.
 * Example: `https://github.com/acme/api/pull/12` gives `CI: acme/api#12`.
 */
export function ciCheckName(url: string): string | null {
  const match = pullRequestUrl.exec(url.trim());
  return match ? `CI: ${match[1]}/${match[2]}#${match[3]}` : null;
}

/**
 * The GitHub pull request URLs in a verify task's instructions, one per line, without repeats.
 * Lines that are not pull request URLs are ignored.
 */
export function pullRequestLines(instructions: string): string[] {
  const urls = instructions
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ciCheckName(line) !== null);
  return [...new Set(urls)];
}

/** One automated, pending CI check per pull request; a verify task settles them later. */
function ciChecks(urls: string[]): CheckInput[] {
  return urls.flatMap((url) => {
    const name = ciCheckName(url);
    return name ? [{ name, kind: 'automated' as const, state: 'pending' as const, url }] : [];
  });
}

/**
 * One check per requirement of the slice: a requirement Aiden found implemented is an automated
 * check that already passed; anything else is a manual check a person must pass, with Aiden's
 * finding as its detail. Example: `REQ-3: Members can sign in`, manual, pending, "Partly implemented".
 */
function requirementChecks(requirements: RequirementVerdict[]): CheckInput[] {
  return requirements.map((requirement) => {
    const name = `${requirement.requirementId}: ${requirement.text}`.slice(0, limits.name);
    return requirement.status === 'implemented'
      ? { name, kind: 'automated', state: 'passed', detail: null }
      : {
          name,
          kind: 'manual',
          state: 'pending',
          detail: requirement.finding.slice(0, limits.detail),
        };
  });
}

/**
 * What the reviewer gets when a build opened pull requests: the reviewer-facing summary (Aiden's
 * verdict, then the coding agent's own summary), the pull requests, and the checks the work must
 * pass after approval. When there are more checks than the server takes, checks already passed
 * are dropped first, so nothing a person or CI still has to settle is lost.
 */
export function buildReview(
  job: Pick<CodingJob, 'message'>,
  pullRequests: string[],
  verdict: string[],
  requirements: RequirementVerdict[],
): ReviewPacket {
  const urls = pullRequests.slice(0, limits.pullRequests);
  return {
    summary: [...verdict, '', job.message].join('\n').trim().slice(0, limits.summary),
    pullRequestUrls: urls,
    checks: capChecks([...ciChecks(urls), ...requirementChecks(requirements)]),
  };
}

/**
 * The review packet for publication a replacement machine recovered: the saved summary and the
 * recovered pull requests, each with a pending CI check. The requirement verdict stayed with the
 * machine that built the work, so recovery cannot add requirement checks.
 */
export function recoveredReview(summary: string, pullRequests: string[]): ReviewPacket {
  const urls = pullRequests.slice(0, limits.pullRequests);
  return {
    summary: summary.slice(0, limits.summary),
    pullRequestUrls: urls,
    checks: capChecks(ciChecks(urls)),
  };
}

/** Keep at most the server's limit, dropping checks that already passed first. */
function capChecks(checks: CheckInput[]): CheckInput[] {
  if (checks.length <= limits.checks) return checks;
  const open = checks.filter((check) => check.state !== 'passed');
  const passed = checks.filter((check) => check.state === 'passed');
  return [...open, ...passed].slice(0, limits.checks);
}

/** A question from the coding agent, as the build's result or checkpoint keeps it. */
export interface AgentQuestion {
  question: string;
  assigneeUserId?: string | undefined;
  role?: WorkRole | undefined;
  scope?: QuestionScope | undefined;
}

/**
 * Question tasks for people, routed by the server: a question keeps the role and scope the coding
 * agent gave it, and otherwise takes the build's own role and is about this task.
 * Example: "Which currency?" with no role, from a build classified fe_engineer, is an fe_engineer
 * question about the task, so it goes to the task's reviewer.
 */
export function questionTasks(
  questions: AgentQuestion[],
  role: WorkRole | null | undefined,
): NewAccountTask[] {
  return questions.map((item) => {
    const chosen = item.role ?? role;
    return {
      actor: 'human',
      kind: 'coding-question',
      title: item.question.slice(0, 200),
      instructions: item.question,
      ...(item.assigneeUserId ? { assigneeUserId: item.assigneeUserId } : {}),
      ...(chosen ? { role: chosen } : {}),
      scope: item.scope ?? 'task',
    };
  });
}
