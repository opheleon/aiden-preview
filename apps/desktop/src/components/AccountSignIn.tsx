import { ArrowRight } from 'lucide-react';
import type { JSX } from 'react';

import type { AccountView } from '../hooks/useAccount';

/** Signed out: one button that opens the browser, where the person signs in or creates an account. */
export function AccountSignIn({ account }: { account: AccountView }): JSX.Element {
  const waiting = !!account.status?.signingIn;
  return (
    <section className="card account-intro" aria-label="Sign in to Teams">
      <h1>
        Work as a <span className="serif">team</span>
      </h1>
      <p>
        Sign in to share projects with your team. Each person&apos;s Aiden picks up your team&apos;s
        work on their own subscription, and you see what needs you.
      </p>
      {waiting ? (
        <p role="status">Finish signing in in your browser. This page updates when you are done.</p>
      ) : (
        <button
          className="primary"
          disabled={account.working}
          onClick={() => void account.signIn()}
        >
          Sign in <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
      <p className="account-muted">
        Sign in or create your account in your browser. Without signing in, Aiden keeps working on
        this computer as it does now.
      </p>
    </section>
  );
}

/**
 * Signed in with no team yet. Teams are created and joined in the Teams dashboard, so this only
 * opens it; an invitation link from a teammate opens the dashboard's join page directly.
 */
export function AccountNoTeam({ account }: { account: AccountView }): JSX.Element {
  const dashboard = account.status?.settingsUrl ?? 'https://app.opheleon.ai';
  return (
    <section className="card account-intro" aria-label="Join a team">
      <h1>
        Join a <span className="serif">team</span>
      </h1>
      <p>
        Create a team or join one in the Teams dashboard. To join, open the invitation link a
        teammate sent you. This page updates once you are in a team.
      </p>
      <button className="primary" onClick={() => void window.aiden?.openExternal(dashboard)}>
        Open the Teams dashboard <ArrowRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}
