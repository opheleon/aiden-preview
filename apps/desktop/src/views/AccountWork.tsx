import { type JSX, useEffect } from 'react';

import { AccountTeam } from '../components/AccountBoard';
import { AccountMachine } from '../components/AccountMachine';
import { AccountNoTeam, AccountSignIn } from '../components/AccountSignIn';
import { useAccount } from '../hooks/useAccount';
import type { Workspace } from '../hooks/useWorkspace';

/** Teams settings: sign in once, then the team, its machines, and how this machine helps. */
export function AccountWork({ workspace }: { workspace: Workspace }): JSX.Element {
  const account = useAccount(workspace.call);
  const { status, state } = account;
  const { setAccountScope } = workspace;
  // Signing in or out, creating, or joining here changes the header tabs without a screen change.
  useEffect(() => {
    if (status) setAccountScope(status.signedIn ? (status.accounts[0]?.id ?? '') : '');
  }, [status, setAccountScope]);
  return (
    <div className="content account-view">
      {account.error && (
        <p className="error" role="alert">
          {account.error}
        </p>
      )}
      {status?.message && <p className="account-muted">{status.message}</p>}
      {status?.signedIn && <AccountProfile account={account} />}
      {!status ? (
        <p className="account-muted">Loading your team…</p>
      ) : !status.signedIn ? (
        <AccountSignIn account={account} />
      ) : !status.accounts.length ? (
        <AccountNoTeam account={account} />
      ) : (
        <>
          {state && <AccountTeam state={state} />}
          <AccountMachine account={account} />
          <p className="account-muted">
            Signed in as {status.email}.{' '}
            <button
              className="text-button"
              disabled={account.working}
              onClick={() => void account.signOut()}
            >
              Sign out
            </button>
          </p>
        </>
      )}
    </div>
  );
}

/** Open the global web profile and admin settings from desktop. */
function AccountProfile({ account }: { account: ReturnType<typeof useAccount> }): JSX.Element {
  const { status, state } = account;
  if (!status) return <></>;
  return (
    <div className="account-row">
      {status.profile?.avatar && (
        <img src={status.profile.avatar} alt="Your profile" width={40} height={40} />
      )}
      <strong>{status.profile?.name || status.email}</strong>
      <button
        onClick={() =>
          void window.aiden?.openExternal(
            `${status.settingsUrl ?? 'https://app.opheleon.ai'}/profile`,
          )
        }
      >
        My profile
      </button>
      {state?.members.some((member) => member.id === status.userId && member.isAdmin) && (
        <button
          onClick={() =>
            void window.aiden?.openExternal(
              `${status.settingsUrl ?? 'https://app.opheleon.ai'}/team?team=${encodeURIComponent(account.accountId)}`,
            )
          }
        >
          Team settings
        </button>
      )}
    </div>
  );
}
