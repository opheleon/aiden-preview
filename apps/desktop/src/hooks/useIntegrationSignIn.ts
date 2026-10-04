import { useEffect } from 'react';

import type { Workspace } from './useWorkspace';

/** Watch an outstanding browser sign-in without reconnecting or creating another OAuth session. */
export function useIntegrationSignIn({
  call,
  integrations,
  setIntegrations,
  setError,
}: Pick<Workspace, 'call' | 'integrations' | 'setIntegrations' | 'setError'>): void {
  const waiting = integrations.some((c) => c.status === 'authorization_required');
  useEffect(() => {
    if (!waiting) return;
    let closed = false;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void call('integrations')
        .then((rows) => {
          if (!closed) setIntegrations(rows);
        })
        .catch(() => {
          if (!closed)
            setError('Could not refresh tracker sign-in. Reopen Integrations to check its status.');
        })
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [call, waiting, setIntegrations, setError]);
}
