import type { JSX } from 'react';

import type { GuideCheckResult } from '../../../../packages/contracts/src/guide';
import type { Workspace } from '../hooks/useWorkspace';
import { AppResults, CodeResults } from './GuideCheckResults';

/** Plain labels for a saved item's status. */
const statusLabels: Record<GuideCheckResult['items'][number]['status'], string> = {
  passed: 'Passed',
  failed: 'Needs work',
  unverified: 'Could not verify',
};

/** The DOM id of a saved result in the thread, so other pages can bring it into view. */
export function guideResultId(runId: string): string {
  return `guide-result-${runId}`;
}

/**
 * A finished check where it happened in the conversation. The newest results show in full, with
 * expandable explanations and evidence; older ones keep their saved per-requirement outcome, so
 * scrolling back always shows what each check found.
 */
export function GuideResultEntry({
  text,
  result,
  workspace,
}: {
  text: string;
  result: GuideCheckResult;
  workspace: Workspace;
}): JSX.Element {
  const app = workspace.verification?.result;
  const latestApp = result.kind === 'app' && app?.runId === result.runId ? app : undefined;
  const latestCode =
    result.kind === 'code' && workspace.report?.id === result.runId ? workspace.report : undefined;
  return (
    <div className="guide-result" id={guideResultId(result.runId)} tabIndex={-1}>
      <p className="guide-event">{text}</p>
      {latestApp ? (
        <AppResults result={latestApp} projectId={workspace.project.id} />
      ) : latestCode ? (
        <CodeResults report={latestCode} />
      ) : (
        result.items.length > 0 && (
          <details className="guide-check-results">
            <summary>{result.kind === 'app' ? 'App check results' : 'Code check results'}</summary>
            <ul className="guide-saved-results" aria-label="Saved check results">
              {result.items.map((item, index) => (
                <li key={`${item.requirementId}-${index}`}>
                  <b>{statusLabels[item.status]}</b> · <code>{item.requirementId}</code>{' '}
                  {item.label}
                </li>
              ))}
            </ul>
          </details>
        )
      )}
    </div>
  );
}
