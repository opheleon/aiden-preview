import path from 'node:path';

import type { RunManifest } from '../../contracts/src/index.js';
import { atomic, optionalJson, uid } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Persist a pending question and await an identity-bound answer; cancellation removes its resolver. */
export async function requestClarification(
  context: WorkflowContext,
  run: RunManifest,
  signal: AbortSignal,
  dir: string,
  question: string,
): Promise<string> {
  signal.throwIfAborted();
  const questionId = uid();
  run.status = 'waiting';
  await atomic(path.join(dir, 'manifest.json'), run);
  await atomic(path.join(dir, 'pending-question.json'), { questionId, question });
  return new Promise<string>((resolve, reject) => {
    /** Remove the unanswered question when its owning run is cancelled. */
    const abort = () => {
      context.questions.delete(questionId);
      reject(new Error('Cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    context.questions.set(questionId, {
      runId: run.id,
      resolve: (answer) => {
        signal.removeEventListener('abort', abort);
        void (async () => {
          const answers =
            (await optionalJson<{ question: string; answer: string }[]>(
              path.join(dir, 'answers.json'),
            )) ?? [];
          answers.push({ question, answer });
          await atomic(path.join(dir, 'answers.json'), answers);
          run.status = 'running';
          await atomic(path.join(dir, 'manifest.json'), run);
          resolve(answer);
        })().catch(reject);
      },
    });
    context.emit({
      type: 'clarification',
      runId: run.id,
      projectId: run.projectId,
      questionId,
      question,
    });
  });
}
