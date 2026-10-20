import type { VerifyMethod } from '../../../../packages/contracts/src/guide';

/** A project control opens a focused action in the existing conversation, without sending a turn. */
export type ProjectChatEntry =
  | { type: 'connections' | 'run' | 'goal' | 'scope' }
  | { type: 'verification'; method?: VerifyMethod }
  | { type: 'requirement'; requirementId: string }
  | { type: 'finding'; requirementId: string; title: string }
  /** Bring a finished check's saved results into view in the thread. */
  | { type: 'result'; runId: string };

/** Attach only the selected public project context to a person's explicit message. */
export function contextualGuideMessage(entry: ProjectChatEntry | null, text: string): string {
  if (entry?.type === 'requirement')
    return `I want to change requirement ${entry.requirementId}. My requested change: ${text}`;
  if (entry?.type === 'finding')
    return `About the finding for requirement ${entry.requirementId}: ${text}`;
  if (entry?.type === 'goal') return `I want to change the project goal: ${text}`;
  if (entry?.type === 'scope') return `I want to change the requirements: ${text}`;
  return text;
}
