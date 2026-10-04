import { type JSX, useState } from 'react';

import type { TicketRecord } from '../../../../packages/contracts/src/tickets';
import type { DeliveryTicket as Ticket } from '../../../../packages/reporting/src/tickets';

/** Review generated scope and its last observed tracker state, with a copyable local ticket. */
export function DeliveryTicket({
  ticket,
  remote,
}: {
  ticket: Ticket;
  remote?: TicketRecord | undefined;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="delivery-ticket" aria-label={`Ticket ${ticket.id}`}>
      <h4>
        {ticket.blocked ? 'Blocked ticket' : 'Delivery ticket'} · {ticket.id}
        {remote
          ? ` · ${remote.state === 'synced' ? 'Published' : remote.state}`
          : ' · Not published'}
      </h4>
      {remote && (
        <div role="status">
          <p>
            {remote.url ? (
              <a href={remote.url} target="_blank" rel="noreferrer">
                {remote.issueId ?? 'Open issue'}
              </a>
            ) : (
              remote.issueId
            )}{' '}
            · Tracker: {remote.remoteStatus ?? 'Not checked yet'} · Assignee:{' '}
            {remote.assignee ?? 'Unassigned'}
          </p>
          <p>{remote.message}</p>
        </div>
      )}
      <p className="row-sub">
        {remote?.issueId ? 'Linked ticket' : 'Local ticket · Owner unassigned'} ·{' '}
        {ticket.blocked
          ? 'Resolve decisions before implementation'
          : 'Check prerequisites before implementation'}
      </p>
      <p className="row-sub">{ticket.title} · Shared requirements use this same ticket.</p>
      <button
        className="text-button"
        onClick={() => {
          void navigator.clipboard
            .writeText(ticket.markdown)
            .then(() => {
              setCopied(true);
              setError('');
            })
            .catch(() => setError('Could not copy the ticket. Try again.'));
        }}
      >
        {copied ? 'Copied ticket' : 'Copy ticket'}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
