import { Copy } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { Call } from '../../../../packages/contracts/src/index';

/** Text to paste to someone else when a decision is not yours to make. */
function askText(call: Call): string {
  const choices = call.options.length ? `\nOptions: ${call.options.join(' / ')}` : '';
  return `${call.question}${choices}\n${call.blocking === false ? 'Reversible assumption' : 'Work paused pending this decision'}: ${call.assumption}`;
}

/**
 * Answer an open decision in place: choose an option or type an answer, then confirm with Answer.
 * Choosing never submits, because an answer rewrites scope and starts a new check. Blocking work
 * waits for it; the answer is used straight away, or as soon as the current investigation ends.
 */
export function DecisionAnswer({
  call,
  onAnswer,
}: {
  call: Call;
  onAnswer: (callId: string, answer: string) => Promise<void>;
}): JSX.Element {
  const [other, setOther] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const answer = chosen ?? other.trim();
  return (
    <>
      <div className="call-options">
        {call.options.map((option) => (
          <button
            key={option}
            type="button"
            className="secondary"
            aria-pressed={option === chosen}
            onClick={() => {
              setChosen(option === chosen ? null : option);
              setOther('');
            }}
          >
            {option}
          </button>
        ))}
        <form
          className="call-other"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer)
              void onAnswer(call.id, answer).then(() => {
                setOther('');
                setChosen(null);
              });
          }}
        >
          <input
            aria-label={`Other answer to ${call.question}`}
            placeholder={call.kind === 'app-url' ? 'http://localhost:3000' : 'Other…'}
            maxLength={2000}
            value={other}
            onChange={(event) => {
              setOther(event.target.value);
              setChosen(null);
            }}
          />
          <button className="primary" disabled={!answer}>
            Answer
          </button>
        </form>
      </div>
      {call.owner === 'someone else' && (
        <p className="teams-edge">
          <button
            className="text-button"
            onClick={() =>
              void navigator.clipboard.writeText(askText(call)).then(() => setCopied(true))
            }
          >
            <Copy size={12} /> {copied ? 'Copied' : 'Copy the question'}
          </button>
          <span>On Teams, Aiden takes this to them and brings the answer back.</span>
        </p>
      )}
    </>
  );
}
