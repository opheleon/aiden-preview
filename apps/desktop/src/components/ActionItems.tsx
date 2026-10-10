import { Check, Copy } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
import type { ActionItem, Risk } from '../renderer/action-items';
import { DecisionAnswer } from './DecisionAnswer';
import { Watch } from './RequirementRow';

/** Items shown before "Show all". */
const shownAtFirst = 6;

/** What one row can do: answer a decision, copy a prompt, watch a recording, or mark done. */
export interface ItemHandlers {
  onAnswer: (callId: string, answer: string) => Promise<void>;
  onWatch: (result: CriterionResult) => void;
  onDone: (key: string) => Promise<void>;
  /** Open the requirement a decision belongs to; absent inside that requirement's own pop-up. */
  onOpen?: ((requirementId: string) => void) | undefined;
}

/** One action item: who, what should happen, why, and the one thing to do about it. */
function Item({ item, handlers }: { item: ActionItem; handlers: ItemHandlers }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <li className="action-item">
      <p className="action-head">
        <span className={`chip chip--${item.role.toLowerCase()}`}>{item.role}</span>
        <strong>{item.action}</strong>
      </p>
      <p className="row-sub">{item.why}</p>
      {item.call && item.requirementId && handlers.onOpen && (
        <button
          type="button"
          className="text-button"
          aria-haspopup="dialog"
          onClick={() => handlers.onOpen?.(item.requirementId!)}
        >
          For {item.requirementId}
        </button>
      )}
      {item.call && <DecisionAnswer call={item.call} onAnswer={handlers.onAnswer} />}
      {(item.prompt || item.result || item.confirmable) && (
        <p className="action-links">
          {item.prompt && (
            <button
              className="text-button"
              onClick={() =>
                void navigator.clipboard.writeText(item.prompt!).then(() => setCopied(true))
              }
            >
              <Copy size={12} aria-hidden="true" /> {copied ? 'Copied' : 'Copy work item'}
            </button>
          )}
          <Watch result={item.result} label={item.key} onWatch={handlers.onWatch} />
          {item.confirmable && (
            <button className="text-button" onClick={() => void handlers.onDone(item.key)}>
              <Check size={12} aria-hidden="true" /> Done
            </button>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * Action items: what Dev and PM have to do next. Aiden writes the list from its latest look, so
 * nobody writes tickets, and an item leaves once a later look sees it done.
 */
export function ActionItems({
  items,
  title = 'Action items',
  embedded = false,
  ...handlers
}: ItemHandlers & {
  items: ActionItem[];
  title?: string;
  embedded?: boolean;
}): JSX.Element | null {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  return (
    <section className={embedded ? 'req-block' : 'brief-card'} aria-label={title}>
      <h3 className="card-label">
        {title} · {items.length}
      </h3>
      <ol className="card-rows">
        {(all ? items : items.slice(0, shownAtFirst)).map((item) => (
          <Item key={item.key} item={item} handlers={handlers} />
        ))}
      </ol>
      {!all && items.length > shownAtFirst && (
        <button className="text-button" onClick={() => setAll(true)}>
          Show all {items.length}
        </button>
      )}
    </section>
  );
}

/** Risks: what Aiden could not verify, with the reason, so nobody mistakes it for done. */
export function Risks({ risks }: { risks: Risk[] }): JSX.Element | null {
  if (!risks.length) return null;
  return (
    <section className="req-block" aria-label="Verification gaps">
      <h3 className="card-label">Verification gaps · {risks.length}</h3>
      <ul className="card-rows">
        {risks.map((risk) => (
          <li key={risk.key} className="card-row">
            <span className="row-main">
              <span className="row-title">
                <code>{risk.label}</code> {risk.text}
              </span>
              <span className="row-sub">{risk.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
