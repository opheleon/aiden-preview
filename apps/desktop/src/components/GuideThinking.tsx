import type { JSX } from 'react';

/**
 * Immediate, quiet activity feedback while the chat loads or Aiden prepares its reply. It names
 * the step under way when there is one, such as "Listing acme's repositories on GitHub".
 */
export function GuideThinking({ doing = '' }: { doing?: string }): JSX.Element {
  return (
    <p className="guide-thinking" role="status" aria-label="Aiden is thinking">
      <span>{doing || 'Thinking'}</span>
    </p>
  );
}
