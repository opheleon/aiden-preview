import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountState } from '../../../../packages/contracts/src/accounts-api';
import type { AccountStatus } from '../../../../packages/contracts/src/api';
import type { DesktopBridge } from '../bridge';

/** How often the Teams screen refreshes while it is open. */
const refreshMs = 15_000;
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
  create: (name: string) => Promise<void>;
  join: (invite: string) => Promise<void>;
  invite: () => Promise<{ code: string; link: string; expiresAt: string }>;
  setAdmin: (userId: string, isAdmin: boolean) => Promise<void>;
  take: (taskId: string) => Promise<void>;
  finish: (taskId: string, answer?: string) => Promise<void>;
  setPickup: (change: { pickupEnabled?: boolean; usageCapPct?: number }) => Promise<void>;
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
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load your team.'),
    );
    const timer = setInterval(() => void refresh().catch(() => undefined), refreshMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
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
    create: (name: string) => act(() => call('accountCreate', { name })),
    join: (invite: string) => act(() => call('accountJoin', { invite })),
    invite: () => call('accountInvite', { accountId }),
    setAdmin: (userId: string, isAdmin: boolean) =>
      act(() => call('accountSetAdmin', { accountId, userId, isAdmin })),
    take: (taskId: string) => act(() => call('accountTakeTask', { taskId })),
    finish: (taskId: string, answer?: string) =>
      act(() => call('accountFinishTask', answer ? { taskId, answer } : { taskId })),
    setPickup: (change: { pickupEnabled?: boolean; usageCapPct?: number }) =>
      act(() => call('accountSetPickup', change)),
  };
}
