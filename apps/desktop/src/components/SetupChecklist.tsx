import { Check } from 'lucide-react';
import type { JSX } from 'react';

import type { SetupProgress, SetupStepId } from '../../../../packages/contracts/src/guide';
import {
  setupTasks,
  type TaskStatus,
  type TaskWho,
} from '../../../../packages/contracts/src/task-model';
import { TaskChip, TaskStatusTag } from './TaskTags';

/** Plain explanations of each setup step, available immediately without a model request. */
const explanations: Record<SetupStepId, string> = {
  understand:
    'Aiden turns what you described, and any Notion pages you linked, into requirements. Questions only you can answer appear here in the chat.',
  confirm:
    'Review the requirements and resolve any open questions before confirming what Aiden should check.',
  code: 'Aiden finds the code on GitHub and picks the recently changed repositories that fit the goal, asking only which organization when you belong to several, so it can explore the code, size the work, and estimate how long it takes. Without code, Aiden suggests delivery slices but gives no estimate.',
  verify:
    'Choose code, web, API, or manual checks. Local code and manual checks confirm directly; web and API connections need an access check. Use the private setup fields for passwords and API keys.',
  'first-check':
    'Check your requirements and see progress, results, and evidence here in the chat. You can skip this for now and run a check later.',
  extras:
    'Optional. Link Linear so Aiden publishes and syncs tickets from the delivery plan. You can do this any time from the Overview.',
};

/**
 * A step's place in the shared task status: the current step is in progress while Aiden works on
 * it, and waiting on a person otherwise.
 */
function stepStatus(step: SetupProgress['steps'][number], working: boolean): TaskStatus {
  if (step.status === 'done') return 'done';
  if (step.status === 'next' && working && setupTasks[step.id].who === 'Aiden')
    return 'in-progress';
  return 'todo';
}

/** One step as a task: who does it, its name, where it stands, and what it involves. */
function SetupStep({
  step,
  number,
  working,
}: {
  step: SetupProgress['steps'][number];
  number: number;
  working: boolean;
}): JSX.Element {
  const optional = step.id === 'extras';
  const status = stepStatus(step, working);
  return (
    <li
      className={`setup-item setup-item-${step.status}`}
      aria-current={step.status === 'next' ? 'step' : undefined}
      aria-label={`${step.label}: ${step.status === 'skipped' ? 'Skipped for now' : status}`}
    >
      <span className="setup-marker" aria-hidden="true">
        {step.status === 'done' ? <Check size={12} /> : number}
      </span>
      <span className="setup-item-text">
        <span className="setup-item-label">
          <TaskChip who={setupTasks[step.id].who} /> {step.label}
          {optional && <span className="setup-optional"> · Optional</span>}{' '}
          {step.status === 'skipped' ? (
            <span className="task-status">Skipped for now</span>
          ) : (
            <TaskStatusTag status={status} />
          )}
        </span>
        <span className="setup-item-detail">{explanations[step.id]}</span>
      </span>
    </li>
  );
}

/** Every setup step as a task: who does it, where it stands, and what it involves. */
export function SetupSteps({
  setup,
  working = false,
}: {
  setup: SetupProgress;
  /** Whether Aiden is working on this project now. */
  working?: boolean;
}): JSX.Element {
  return (
    <ol className="setup-steps" aria-label="Setup">
      {setup.steps.map((step, index) => (
        <SetupStep key={step.id} step={step} number={index + 1} working={working} />
      ))}
    </ol>
  );
}

/**
 * Where setup stands in a few words, and the next step. Example: step 2 of 5 reads "Setup 2 of 5"
 * with the next step "Review requirements" done by PM.
 */
export function setupSummary(setup: SetupProgress): {
  label: string;
  next: { who: TaskWho; label: string; detail: string } | null;
} {
  const required = setup.steps.filter((step) => step.id !== 'extras');
  const current = required.find((step) => step.id === setup.next);
  if (setup.complete || !current) return { label: 'Setup complete', next: null };
  const position = required.indexOf(current) + 1;
  return {
    label: `Setup ${position} of ${required.length}`,
    next: { who: setupTasks[current.id].who, label: current.label, detail: current.detail },
  };
}
