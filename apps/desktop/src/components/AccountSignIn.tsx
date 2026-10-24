import { ArrowRight } from 'lucide-react';
import { type JSX, useState } from 'react';

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
        Sign in in your browser with the account your team admin set up for you. Without signing in,
        Aiden keeps working on this computer as it does now.
      </p>
    </section>
  );
}

/** Signed in with no team yet: create one or paste an invite link. */
export function AccountSetup({ account }: { account: AccountView }): JSX.Element {
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  return (
    <section className="card account-intro" aria-label="Set up your team">
      <h1>
        Start or join a <span className="serif">team</span>
      </h1>
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          void account.create(name);
        }}
      >
        <label htmlFor="team-name">Create a team</label>
        <div className="account-row">
          <input
            id="team-name"
            placeholder="Team name"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="primary" disabled={account.working || !name.trim()}>
            Create <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </form>
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          void account.join(invite);
        }}
      >
        <label htmlFor="team-invite">Join with an invite link</label>
        <div className="account-row">
          <input
            id="team-invite"
            placeholder="opheleon://join?code=…"
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
          />
          <button disabled={account.working || !invite.trim()}>Join</button>
        </div>
      </form>
    </section>
  );
}
