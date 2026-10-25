import type { JSX } from 'react';

import type { AccountState } from '../../../../packages/contracts/src/accounts-api';

/**
 * The team itself: members and the machines picking up its work. Invitations, admin access, and
 * removing people happen in the Teams dashboard.
 */
export function AccountTeam({ state }: { state: AccountState }): JSX.Element {
  return (
    <div className="account-board">
      <header className="account-header">
        <h1>{state.account.name}</h1>
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
