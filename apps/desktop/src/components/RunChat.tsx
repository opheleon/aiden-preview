import { ArrowUp } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { ChatMessage } from '../../../../packages/contracts/src/index';

/**
 * The conversation about one run: your questions on the right, Aiden's answers in its own voice.
 * Answers taken from the reason Aiden recorded at the time say so; follow-ups are answered from the
 * run's saved record.
 */
export function RunChat({
  messages,
  thinking,
  asking,
  error,
  onAsk,
}: {
  messages: ChatMessage[];
  thinking: boolean;
  /** A question sent but not answered yet. */
  asking: string;
  error: string;
  onAsk: (question: string) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <div className="run-chat" aria-label="Ask about this run">
      {messages.map((m) =>
        m.from === 'you' ? (
          <p key={`${m.at}-you`} className="chat-you">
            {m.text}
          </p>
        ) : (
          <div key={`${m.at}-aiden`} className="chat-aiden">
            <p>{m.text}</p>
            {m.source === 'log' && <small>From the run log, written when Aiden acted.</small>}
          </div>
        ),
      )}
      {asking && <p className="chat-you">{asking}</p>}
      {thinking && (
        <p className="chat-thinking" aria-live="polite">
          Aiden is reading the run record…
        </p>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          const question = draft.trim();
          if (question) void onAsk(question).then(() => setDraft(''));
        }}
      >
        <input
          aria-label="Ask about this run"
          placeholder="Ask about this run"
          maxLength={1000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="chat-send" aria-label="Send" disabled={thinking || !draft.trim()}>
          <ArrowUp size={15} />
        </button>
      </form>
    </div>
  );
}
