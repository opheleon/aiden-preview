import type { JSX } from 'react';

/**
 * Ordered steps that follow one of Aiden's chat answers, so a how-to reply reads as a short
 * checklist instead of a paragraph. Renders nothing when the answer recommends no steps.
 */
export function ChatSteps({ steps }: { steps: string[] | undefined }): JSX.Element | null {
  if (!steps?.length) return null;
  return (
    <ol className="chat-steps" aria-label="Next steps">
      {steps.map((step, index) => (
        <li key={`${index}-${step}`}>{step}</li>
      ))}
    </ol>
  );
}
