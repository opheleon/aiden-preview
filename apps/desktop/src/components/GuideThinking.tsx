import type { JSX } from 'react';

/** Immediate, quiet activity feedback while the chat loads or Aiden prepares its reply. */
export function GuideThinking(): JSX.Element {
  return (
    <p className="guide-thinking" role="status" aria-label="Aiden is thinking">
      <span>Thinking</span>
    </p>
  );
}
