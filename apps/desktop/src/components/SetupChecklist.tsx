import { Check } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { SetupProgress, SetupStepId } from '../../../../packages/contracts/src/guide';

/** Plain explanations of each setup step, available immediately without a model request. */
const explanations: Record<SetupStepId, string> = {
  understand:
    'Describe what you want to build or change. Aiden asks about missing details here in the chat. Connecting code is optional.',
  confirm:
    'Review the requirements and resolve any open questions before confirming what Aiden should check.',
  code: 'Paste the GitHub repositories for the project so Aiden can explore the code, size the work, and estimate how long it takes. Without code, Aiden suggests delivery slices but gives no estimate.',
  verify:
    'Choose code, web, API, or manual checks. Local code and manual checks confirm directly; web and API connections need an access check. Use the private setup fields for passwords and API keys.',
  'first-check':
    'Check your requirements and see progress, results, and evidence here in the chat. You can skip this for now and run a check later.',
  extras:
    'Optional. Link Linear so Aiden publishes and syncs tickets from the delivery plan. You can do this any time from the Overview.',
};

/** One step with its status marker, label, and what it involves. */
function SetupStep({
  step,
  number,
}: {
  step: SetupProgress['steps'][number];
  number: number;
}): JSX.Element {
  const status = { done: 'Done', next: 'Current step', todo: 'To do', skipped: 'Skipped for now' };
  const optional = step.id === 'extras';
  return (
    <li
      className={`setup-item setup-item-${step.status}`}
      aria-current={step.status === 'next' ? 'step' : undefined}
      aria-label={`${step.label}: ${status[step.status]}`}
    >
      <span className="setup-marker" aria-hidden="true">
        {step.status === 'done' ? <Check size={12} /> : number}
      </span>
      <span className="setup-item-text">
        <span className="setup-item-label">
          {step.label}
          {optional && <span className="setup-optional"> · Optional</span>}
        </span>
        <span className="setup-item-detail">{explanations[step.id]}</span>
      </span>
    </li>
  );
}

/**
 * One compact line at the top of the chat: where setup stands and the next action. The full list
 * of steps, including the optional ticket tracker, opens on demand without changing setup or the
 * draft.
 */
export function SetupChecklist({ setup }: { setup: SetupProgress }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const required = setup.steps.filter((step) => step.id !== 'extras');
  const current = required.find((step) => step.id === setup.next);
  const position = required.findIndex((step) => step.id === setup.next) + 1;
  return (
    <section className="setup-checklist" aria-label="Project setup">
      <div className="setup-heading">
        <p className="setup-current" role="status" aria-label="Setup status">
          {setup.complete && <Check size={14} aria-hidden="true" />}
          {setup.complete ? 'Setup complete' : 'Setup not complete'}
        </p>
        {current && (
          <p className="setup-next-action">
            {`Step ${position} of ${required.length} · ${current.label}`}
            <span className="setup-next-detail"> · {current.detail}</span>
          </p>
        )}
        <button
          className="text-button setup-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide steps' : 'Show steps'}
        </button>
      </div>
      {expanded && (
        <ol className="setup-steps" aria-label="Setup">
          {setup.steps.map((step, index) => (
            <SetupStep key={step.id} step={step} number={index + 1} />
          ))}
        </ol>
      )}
    </section>
  );
}
