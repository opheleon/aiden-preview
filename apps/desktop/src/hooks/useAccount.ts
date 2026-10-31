import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountState } from '../../../../packages/contracts/src/accounts-api';
import type { AccountStatus } from '../../../../packages/contracts/src/api';
import type { DesktopBridge } from '../bridge';

/** How often the Teams screen refreshes while it is open and no agent work is under way. */
const refreshMs = 15_000;
/** How often it refreshes while an agent task is waiting or running, so pickups show promptly. */
const activeMs = 5_000;
/** How often it checks while a browser sign-in is waiting. */
const signingInMs = 2_000;

/** The Teams screen's data and actions. */
export interface AccountView {
  status: AccountStatus | null;
  state: AccountState | null;
  accountId: string;
  setAccountId: (id: string) => void;
  error: string;
  working: boolean;
  /** When the screen last loaded fresh data; null until the first load finishes. */
  refreshedAt: Date | null;
  /** Load fresh data now instead of waiting for the next automatic refresh. */
  reload: () => Promise<void>;
  /** Open the browser to sign in; the screen updates when it finishes. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  take: (taskId: string) => Promise<void>;
  finish: (taskId: string, answer?: string) => Promise<void>;
  setPickup: (change: { pickupEnabled?: boolean; usageCapPct?: number }) => Promise<void>;
  /** Move a project made on this computer into the team; a failure shows in `error`. */
  share: (projectId: string) => Promise<void>;
}

/** The Teams screen's data and actions. The session token never reaches this window. */
export function useAccount(call: DesktopBridge['request']): AccountView {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [accountId, setAccountId] = useState('');
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const next = await call('accountStatus');
    if (!mounted.current) return;
    setStatus(next);
    const chosen = next.accounts.some((a) => a.id === accountId)
      ? accountId
      : (next.accounts[0]?.id ?? '');
    setAccountId(chosen);
    setState(chosen ? await call('accountState', { accountId: chosen }) : null);
    setRefreshedAt(new Date());
  }, [call, accountId]);
  // Agent work that is waiting or running can change any moment; idle teams change rarely.
  const active = !!state?.tasks.some(
    (task) => task.actor === 'agent' && (task.status === 'queued' || task.status === 'leased'),
  );
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load your team.'),
    );
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(
      () => void refresh().catch(() => undefined),
      active ? activeMs : refreshMs,
    );
    return () => clearInterval(timer);
  }, [refresh, active]);
  const signingIn = !!status?.signingIn;
  useEffect(() => {
    if (!signingIn) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), signingInMs);
    return () => clearInterval(timer);
  }, [signingIn, refresh]);
  /** Run an action, show its failure, and refresh afterwards. */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError('');
      setWorking(true);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setWorking(false);
      }
    },
    [refresh],
  );
  return {
    status,
    state,
    accountId,
    setAccountId,
    error,
    working,
    refreshedAt,
    reload: () => act(() => Promise.resolve()),
    signIn: () => act(() => call('accountSignIn')),
    signOut: () => act(() => call('accountSignOut')),
    take: (taskId: string) => act(() => call('accountTakeTask', { taskId })),
    finish: (taskId: string, answer?: string) =>
      act(() => call('accountFinishTask', answer ? { taskId, answer } : { taskId })),
    setPickup: (change: { pickupEnabled?: boolean; usageCapPct?: number }) =>
      act(() => call('accountSetPickup', change)),
    share: (projectId: string) =>
      act(async () => {
        if (!(await call('accountShareProject', { accountId, projectId })))
          throw new Error('The team could not read this project. Update Aiden and try again.');
      }),
  };
}
