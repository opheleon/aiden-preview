import { Check } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { Call } from '../../../../packages/contracts/src/index';
import type { Guide } from '../hooks/useGuide';

/**
 * Keep choices local to this question until Submit; typed messages remain independent. The
 * question stays answerable while a check runs: the answer is saved at once, and the requirements
 * update when the check finishes. Only the Guide's own reply in progress holds it.
 */
function QuestionChoices({ question, guide }: { question: Call; guide: Guide }): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const multiple = question.selectionMode === 'multiple';
  const choices = question.options.filter((option) => selected.includes(option));
  const disabled = guide.thinking;
  return (
    <section className="guide-clarification" aria-label="Clarify your goal">
      <p className="chat-aiden guide-reply">{question.question}</p>
      {question.options.length > 0 && (
        <>
          <p className="guide-event">{multiple ? 'Choose all that apply.' : 'Choose one.'}</p>
          <div className="guide-suggestions" role="group" aria-label="Answer choices">
            {question.options.map((option) => (
              <button
                key={option}
                disabled={disabled}
                aria-pressed={choices.includes(option)}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(option)
                      ? current.filter((value) => value !== option)
                      : multiple
                        ? [...current, option]
                        : [option],
                  )
                }
              >
                {choices.includes(option) && <Check size={14} aria-hidden="true" />}
                {option}
              </button>
            ))}
          </div>
          <div className="guide-card-actions">
            <button
              className="primary"
              disabled={disabled || !choices.length}
              onClick={() => void guide.answer(question.id, choices.join('\n'))}
            >
              Submit
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Ask one question in the conversation, supporting explicit single or multiple selections. */
export function GuideClarification({
  guide,
  busy,
}: {
  guide: Guide;
  busy: boolean;
}): JSX.Element | null {
  const question = guide.view?.clarifications?.[0];
  if (question) return <QuestionChoices key={question.id} question={question} guide={guide} />;
  if (guide.thinking || busy || !guide.view?.requirementsPending) return null;
  return (
    <p className="guide-event">
      Your answers are saved.{' '}
      <button className="text-button" onClick={() => void guide.retry()}>
        Update requirements
      </button>
    </p>
  );
}
