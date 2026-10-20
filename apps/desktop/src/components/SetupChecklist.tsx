import { Check } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { SetupProgress, SetupStepId } from '../../../../packages/contracts/src/guide';

/** Plain explanations of each setup step, available immediately without a model request. */
const explanations: Record<SetupStepId, string> = {
  understand:
    'Describe what you want to build or change. Aiden asks about missing details here in the chat. Connecting code is optional.',
  confirm:
    'Review the requirements and resolve any open questions before confirming what Aiden should check.',
  verify:
    'Choose code, web, API, or manual checks. Local code and manual checks confirm directly; web and API connections need an access check. Use the private setup fields for passwords and API keys.',
  'first-check':
    'Check your requirements and see progress, results, and evidence here in the chat. You can skip this for now and run a check later.',
  extras: 'Optionally connect a ticket tracker. You can finish setup without it and add it later.',
};

/** One checklist item with a status marker; its explanation is shown in the step guide below. */
function SetupStep({
  step,
  number,
}: {
  step: SetupProgress['steps'][number];
  number: number;
}): JSX.Element {
  const status = { done: 'Done', next: 'Current step', todo: 'To do', skipped: 'Skipped for now' };
  return (
    <li
      className={`setup-item setup-item-${step.status}`}
      aria-current={step.status === 'next' ? 'step' : undefined}
      aria-label={`${step.label}: ${status[step.status]}`}
    >
      <span className="setup-marker" aria-hidden="true">
        {step.status === 'done' ? <Check size={13} /> : number}
      </span>
      <span className="setup-item-label">{step.label}</span>
    </li>
  );
}

/**
 * Keep the current step obvious with its explanation in plain view, and let people read what every
 * step involves without changing setup or their draft.
 */
export function SetupChecklist({ setup }: { setup: SetupProgress }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const required = setup.steps.filter((step) => step.id !== 'extras');
  const current = required.find((step) => step.id === setup.next);
  const extras = setup.steps.find((step) => step.id === 'extras');
  const showSteps = !setup.complete || expanded;
  return (
    <section className="setup-checklist" aria-label="Project setup">
      <div className="setup-heading">
        <div>
          <p className="setup-current" role="status" aria-label="Setup status">
            {setup.complete && <Check size={14} aria-hidden="true" />}
            {setup.complete ? 'Setup complete' : 'Setup not complete'}
          </p>
          {!setup.complete && (
            <p className="setup-next-action">
              {`Step ${required.findIndex((step) => step.id === setup.next) + 1} of ${required.length} · ${current?.label ?? 'Project setup'}`}
            </p>
          )}
          {current && <p className="setup-next-action">{current.detail}</p>}
          {current && <p className="setup-explanation">{explanations[current.id]}</p>}
        </div>
        {setup.complete && (
          <button
            className="text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            Setup details
          </button>
        )}
      </div>
      {showSteps && (
        <>
          <ol className="setup-steps" aria-label="Setup">
            {required.map((step, index) => (
              <SetupStep key={step.id} step={step} number={index + 1} />
            ))}
          </ol>
          {extras && (
            <p className="setup-extras">
              {extras.status === 'done' ? 'Ticket tracker connected.' : explanations.extras}
            </p>
          )}
          <details className="setup-guide">
            <summary>What each step involves</summary>
            <dl>
              {required.map((step) => (
                <div key={step.id}>
                  <dt>{step.label}</dt>
                  <dd>{explanations[step.id]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </section>
  );
}
