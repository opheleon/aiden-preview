import { ArrowRight } from 'lucide-react';
import type { JSX } from 'react';

import type { AccountView } from '../hooks/useAccount';

/**
 * Signed out: one button that opens the browser to sign in to an existing Teams account. Accounts
 * come from a team invitation or a Teams purchase in the dashboard, never from this app.
 */
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
        Sign in with the email your team invited, or the one you bought Teams with. Without signing
        in, Aiden keeps working on this computer as it does now.
      </p>
    </section>
  );
}
