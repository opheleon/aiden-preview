import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type { RunEvent } from '../../../../packages/contracts/src/index';

interface ClarificationDialogProps {
  question: RunEvent;
  answer: string;
  setAnswer: React.Dispatch<React.SetStateAction<string>>;
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  setQuestion: React.Dispatch<React.SetStateAction<RunEvent | undefined>>;
  /** Set when the question comes from a run in another project, so the answer lands knowingly. */
  otherProject?: string | undefined;
}

/** Collect an answer for the active provider clarification, naming its project when it is another. */
export function ClarificationDialog(props: ClarificationDialogProps): React.JSX.Element {
  const { question, answer, setAnswer, action, call, setQuestion, otherProject } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, [question.questionId]);
  return (
    <section className="modal card" role="dialog" aria-modal="true" aria-label="Clarification">
      <div className="eyebrow">
        {otherProject ? `A LITTLE MORE CONTEXT · FOR ${otherProject}` : 'A LITTLE MORE CONTEXT'}
      </div>
      <h2>{question.question}</h2>
      <textarea
        ref={input}
        aria-label="Clarification answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <button
        className="primary"
        disabled={!answer.trim()}
        onClick={() =>
          void action(async () => {
            await call('answer', {
              runId: question.runId,
              questionId: question.questionId!,
              answer,
            });
            setQuestion(undefined);
          })
        }
      >
        Continue <ArrowRight size={15} />
      </button>
    </section>
  );
}
