import { Check } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { SetupProgress, SetupStepId } from '../../../../packages/contracts/src/guide';
import { SetupStepTooltip } from './SetupStepTooltip';

/** Plain explanations of each setup step, available immediately without a model request. */
const explanations: Record<SetupStepId, string> = {
  understand:
    'Describe what you want to build or change. Aiden asks about missing details here in the chat. Connecting code is optional.',
  confirm:
    'Review the requirements and resolve any open questions before confirming what Aiden should check.',
  verify:
    'Choose code, web, API, or manual checks. Aiden verifies access before saving. Use the private setup fields for passwords and API keys.',
  'first-check':
    'Check your requirements and see progress, results, and evidence here in the chat. You can skip this for now and run a check later.',
  extras: 'Optionally connect a ticket tracker. You can finish setup without it and add it later.',
};

/** One checklist item with a status marker and an independently accessible explanation button. */
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
      <SetupStepTooltip label={step.label} text={explanations[step.id]} />
    </li>
  );
}

/** Keep the current step obvious and let people inspect any step without changing setup or their draft. */
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
          <p className="setup-current">
            {setup.complete ? (
              <>
                <Check size={14} aria-hidden="true" /> Setup complete
              </>
            ) : (
              `Step ${required.findIndex((step) => step.id === setup.next) + 1} of ${required.length} · ${current?.label ?? 'Project setup'}`
            )}
          </p>
          {current && <p className="setup-next-action">{current.detail}</p>}
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
            <div className="setup-extras">
              <span>
                {extras.status === 'done'
                  ? 'Ticket tracker connected'
                  : 'Optional: connect a ticket tracker'}
              </span>
              <SetupStepTooltip label="Extras" text={explanations.extras} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
