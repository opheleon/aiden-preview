import { Copy, UserPlus } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { AccountState } from '../../../../packages/contracts/src/accounts-api';
import type { AccountView } from '../hooks/useAccount';

/** Invite link for owners, copied in one click. */
function Invite({ account }: { account: AccountView }): JSX.Element {
  const [link, setLink] = useState('');
  const [failed, setFailed] = useState('');
  return (
    <div className="account-invite">
      {link ? (
        <button onClick={() => void navigator.clipboard?.writeText(link)} title={link}>
          <Copy size={14} aria-hidden="true" /> Copy invite link
        </button>
      ) : (
        <button
          onClick={() =>
            void account
              .invite()
              .then((invite) => setLink(invite.link))
              .catch((e: unknown) =>
                setFailed(e instanceof Error ? e.message : 'Could not create an invite.'),
              )
          }
        >
          <UserPlus size={14} aria-hidden="true" /> Invite someone
        </button>
      )}
      {failed && <span className="account-muted">{failed}</span>}
    </div>
  );
}

/** The team itself: members, admin controls, and machines picking up its work. */
export function AccountTeam({
  account,
  state,
}: {
  account: AccountView;
  state: AccountState;
}): JSX.Element {
  const me = state.members.find((member) => member.id === account.status?.userId);
  const owner = me?.role === 'owner';
  return (
    <div className="account-board">
      <header className="account-header">
        <h1>{state.account.name}</h1>
        {me?.isAdmin && <Invite account={account} />}
      </header>
      <section className="card" aria-label="Members">
        <div className="card-label">Members</div>
        <ul className="account-list">
          {state.members.map((member) => (
            <li key={member.id} className="account-task">
              <strong>{member.name || member.email}</strong>
              <span className="account-muted">
                {member.email} ·{' '}
                {member.role === 'owner' ? 'Owner' : member.isAdmin ? 'Admin' : 'Member'}
              </span>
              {owner && member.role === 'member' && (
                <button
                  className="text-button"
                  disabled={account.working}
                  onClick={() => void account.setAdmin(member.id, !member.isAdmin)}
                >
                  {member.isAdmin ? 'Remove admin access' : 'Make admin'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-label="Machines">
        <div className="card-label">Machines</div>
        {state.devices.length ? (
          <ul className="account-list">
            {state.devices.map((device) => (
              <li key={device.deviceId} className="account-task">
                <strong>{device.name}</strong>
                <span className="account-muted">
                  {device.owner} ·{' '}
                  {!device.pickupEnabled
                    ? 'Not picking up work'
                    : device.busy
                      ? 'Working'
                      : 'Ready'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card-empty">
            No machines picking up work. Work waits until someone opens Aiden.
          </p>
        )}
      </section>
    </div>
  );
}
