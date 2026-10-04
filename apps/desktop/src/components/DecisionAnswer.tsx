import { Copy } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { Call } from '../../../../packages/contracts/src/index';

/** Text to paste to someone else when a decision is not yours to make. */
function askText(call: Call): string {
  const choices = call.options.length ? `\nOptions: ${call.options.join(' / ')}` : '';
  return `${call.question}${choices}\n${call.blocking === false ? 'Reversible assumption' : 'Work paused pending this decision'}: ${call.assumption}`;
}

/**
 * Answer an open decision in place: one click on an option, or a typed answer. Blocking work waits
 * for it; the answer is used straight away, or as soon as the current investigation ends.
 */
export function DecisionAnswer({
  call,
  onAnswer,
}: {
  call: Call;
  onAnswer: (callId: string, answer: string) => Promise<void>;
}): JSX.Element {
  const [other, setOther] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="call-options">
        {call.options.map((option) => (
          <button key={option} className="secondary" onClick={() => void onAnswer(call.id, option)}>
            {option}
          </button>
        ))}
        <form
          className="call-other"
          onSubmit={(event) => {
            event.preventDefault();
            if (other.trim()) void onAnswer(call.id, other.trim()).then(() => setOther(''));
          }}
        >
          <input
            aria-label={`Other answer to ${call.question}`}
            placeholder={call.kind === 'app-url' ? 'http://localhost:3000' : 'Other…'}
            maxLength={2000}
            value={other}
            onChange={(event) => setOther(event.target.value)}
          />
          <button className="primary" disabled={!other.trim()}>
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
