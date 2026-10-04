import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import type { RunBlockage } from '../renderer/run-blockers';
import { DecisionAnswer } from './DecisionAnswer';

/** Put the missing decision and its answer control next to the blocked run. */
export function RunBlockers({
  blockage,
  workspace,
}: {
  blockage: RunBlockage;
  workspace: Workspace;
}): JSX.Element {
  return (
    <section className="brief-card" aria-label="Waiting for information">
      <h2 className="card-label">
        {blockage.all ? 'Blocked' : 'Partly blocked'} · Needs an answer
      </h2>
      <p className="row-sub">
        {blockage.all
          ? 'Work is waiting for the decisions below. Recording findings can finish while work is blocked.'
          : 'Affected requirements and their dependencies are waiting. Independent work can continue.'}{' '}
        Answering updates the scope and starts a new check, once any current investigation finishes.
      </p>
      {blockage.calls.map((call) => (
        <div className="call-item" key={call.id}>
          <p className="call-question">{call.question}</p>
          <p className="row-sub">
            Owner: {call.owner}. {call.assumption}
          </p>
          <DecisionAnswer call={call} onAnswer={workspace.answerCall} />
        </div>
      ))}
    </section>
  );
}
