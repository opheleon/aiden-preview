import { type JSX, useEffect } from 'react';

import { AccountTeam } from '../components/AccountBoard';
import { AccountLocalProjects } from '../components/AccountLocalProjects';
import { AccountMachine } from '../components/AccountMachine';
import { AccountSignIn } from '../components/AccountSignIn';
import { useAccount } from '../hooks/useAccount';
import { teamTarget } from '../hooks/useTeamScope';
import type { Workspace } from '../hooks/useWorkspace';

/** The Teams tab in Settings: sign in once, then the team, its machines, and how this machine helps. */
export function AccountWork({ workspace }: { workspace: Workspace }): JSX.Element {
  const account = useAccount(workspace.call);
  const { status, state } = account;
  const { setAccountScope, setSignedIn, projects, setProjects, call } = workspace;
  const team = status?.accounts.find((a) => a.id === account.accountId)?.name ?? 'your team';
  // Signing in or out here changes the header tabs and the sidebar without a screen change.
  useEffect(() => {
    if (!status) return;
    setAccountScope(teamTarget(status).scope);
    setSignedIn(status.signedIn);
  }, [status, setAccountScope, setSignedIn]);
  return (
    <div className="account-view">
      {account.error && (
        <p className="error" role="alert">
          {account.error}
        </p>
      )}
      {status?.message && (
        <p className="error" role="alert">
          {status.message}
        </p>
      )}
      {status?.signedIn && <AccountProfile account={account} />}
      {!status ? (
        <p className="account-muted">Loading your team…</p>
      ) : !status.signedIn ? (
        <AccountSignIn account={account} />
      ) : !status.accounts.length ? (
        // Signed in but the team did not answer; status.message above says why.
        <button disabled={account.working} onClick={() => void account.reload()}>
          Try again
        </button>
      ) : (
        <>
          {state && <AccountTeam state={state} />}
          <AccountLocalProjects
            projects={projects}
            team={team}
            working={account.working}
            onSync={async (projectId) => {
              await account.share(projectId);
              setProjects(await call('projects'));
            }}
          />
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
