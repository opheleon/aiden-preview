import type { JSX } from 'react';

import type { AccountView } from '../hooks/useAccount';

/** Usage caps offered; 70% is the default so a member keeps headroom for their own sessions. */
const caps = [50, 70, 90];

/** This machine: whether it picks up account work, the one setting, and the last answer. */
export function AccountMachine({ account }: { account: AccountView }): JSX.Element | null {
  const status = account.status;
  if (!status) return null;
  const now = status.running
    ? `Working on ${status.running.title}`
    : status.pickupEnabled
      ? (status.last?.reason ?? 'Asking your team for work')
      : 'Not picking up team work';
  return (
    <section className="card account-machine" aria-label="This machine">
      <div>
        <div className="card-label">This machine · {status.deviceName}</div>
        <p role="status">{now}</p>
      </div>
      <label className="account-toggle">
        <input
          type="checkbox"
          checked={status.pickupEnabled}
          disabled={account.working}
          onChange={(event) => void account.setPickup({ pickupEnabled: event.target.checked })}
        />
        Pick up team work
      </label>
      <label className="account-cap">
        Stop at
        <select
          value={status.usageCapPct}
          disabled={account.working || !status.pickupEnabled}
          onChange={(event) => void account.setPickup({ usageCapPct: Number(event.target.value) })}
        >
          {caps.map((cap) => (
            <option key={cap} value={cap}>
              {cap}%
            </option>
          ))}
        </select>
        of my model usage
      </label>
    </section>
  );
}
