import { type JSX, useEffect, useState } from 'react';

import type { RuntimeDiagnostic } from '../../../../packages/contracts/src/api';
import type { DesktopBridge } from '../bridge';

/** Official Claude Code setup guide; the only page this control opens. */
const claudeInstallGuide = 'https://docs.claude.com/en/docs/claude-code/setup';
/** How often and for how long Aiden rechecks the connection after opening sign-in. */
const pollMs = 5000;
const pollLimit = 120;

/**
 * Claude subscription connection: install help when Claude Code is missing, and a Sign in with
 * Claude button that opens Claude Code's own sign-in in Terminal. Aiden then rechecks the
 * connection on its own, so the person only finishes sign-in in the browser and comes back.
 */
export function ClaudeSignIn({
  status,
  api,
  action,
  onRefresh,
  setMessage,
}: {
  status: RuntimeDiagnostic | undefined;
  api: DesktopBridge | undefined;
  action: (fn: () => Promise<void>) => Promise<void>;
  onRefresh: () => Promise<void>;
  setMessage: (value: string) => void;
}): JSX.Element {
  const [polls, setPolls] = useState(0);
  const connected = !!status?.subscription;
  const waiting = polls > 0 && polls <= pollLimit && !connected;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      void onRefresh()
        .catch(() => {})
        .finally(() => setPolls((count) => count + 1));
    }, pollMs);
    return () => clearTimeout(timer);
  }, [waiting, polls, onRefresh]);
  useEffect(() => {
    if (connected && polls > 0) setMessage('Claude is connected. You can start a project.');
  }, [connected, polls, setMessage]);
  const missing = status?.subscriptionState === 'unavailable' || status?.installed === false;
  return (
    <div aria-live="polite" data-testid="claude-connection" className="claude-sign-in">
      <p>{status?.message ?? 'Checking Claude subscription sign-in…'}</p>
      {missing && (
        <button
          className="text-button"
          disabled={!api}
          onClick={() => void action(async () => api?.openExternal(claudeInstallGuide))}
        >
          Claude Code installation guide
        </button>
      )}
      {status?.subscriptionState === 'sign_in_required' && (
        <>
          <ol className="connect-steps">
            <li>Select Sign in with Claude. A Terminal window opens with Claude Code sign-in.</li>
            <li>Finish signing in with your paid Claude plan in the browser.</li>
            <li>Come back here. Aiden checks the connection for you.</li>
          </ol>
          <button
            className="secondary"
            disabled={!api || waiting}
            onClick={() =>
              void action(async () => {
                await api?.request('login', { provider: 'claude' });
                setPolls(1);
                setMessage('Finish signing in from the Terminal window and your browser.');
              })
            }
          >
            {waiting ? 'Waiting for sign-in…' : 'Sign in with Claude'}
          </button>
        </>
      )}
    </div>
  );
}
