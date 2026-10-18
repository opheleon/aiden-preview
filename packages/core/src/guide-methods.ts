import { z } from 'zod/v3';

import type { WorkerMethod } from '../../contracts/src/api.js';
import { SetupStepIdSchema } from '../../contracts/src/guide.js';
import { id, ProjectSchema } from '../../contracts/src/index.js';
import { VerificationUpdateSchema } from '../../contracts/src/verification.js';
import type { Engine } from './engine.js';
import { askGuide, guideChange, openGuide, recordGuideEvent } from './guide.js';
import { confirmRequirements, skipSetupStep } from './guide-actions.js';
import { configureGuideVerification, testAppUrl } from './guide-verification.js';

const project = z.object({ projectId: id }).strict();

/** Worker operations the Guide owns. */
type GuideMethod = Extract<
  WorkerMethod,
  | 'guide'
  | 'askGuide'
  | 'guideEvent'
  | 'confirmRequirements'
  | 'skipSetupStep'
  | 'testAppUrl'
  | 'configureGuideVerification'
>;

/** Validate unknown worker inputs before dispatching a typed Guide operation. */
function operation<T>(
  schema: z.ZodType<T>,
  call: (params: T) => unknown,
): (params: unknown) => unknown {
  return Object.assign((params: unknown) => call(schema.parse(params)), {
    validate: (params: unknown) => {
      schema.parse(params);
    },
  });
}

/** The project Guide's worker operations: its thread, its turns, and the setup checklist. */
export function guideMethods(engine: Engine): Record<GuideMethod, (params: unknown) => unknown> {
  return {
    configureGuideVerification: operation(
      project
        .extend({
          update: VerificationUpdateSchema,
          save: z.boolean(),
          code: ProjectSchema.optional(),
        })
        .strict(),
      async (p) => {
        const result = await configureGuideVerification(
          engine,
          p.projectId,
          p.update,
          p.save,
          p.code,
        );
        if (p.save) await recordGuideEvent(engine, p.projectId, result.message);
        return result;
      },
    ),
    guide: operation(project, (p) => openGuide(engine, p.projectId)),
    askGuide: operation(
      project
        .extend({
          text: z.string().trim().min(1).max(2000).optional(),
          kickoff: z.boolean().optional(),
          retry: z.boolean().optional(),
          clarification: z
            .object({ callId: id, answer: z.string().trim().min(1).max(2000) })
            .strict()
            .optional(),
        })
        .strict(),
      (p) =>
        askGuide(engine, p.projectId, {
          ...(p.text ? { text: p.text } : {}),
          ...(p.kickoff ? { kickoff: true } : {}),
          ...(p.retry ? { retry: true } : {}),
          ...(p.clarification ? { clarification: p.clarification } : {}),
        }),
    ),
    guideEvent: operation(
      project.extend({ text: z.string().trim().min(1).max(500) }).strict(),
      (p) => recordGuideEvent(engine, p.projectId, p.text),
    ),
    confirmRequirements: operation(project, (p) =>
      guideChange(
        engine,
        p.projectId,
        () => confirmRequirements(engine, p.projectId),
        'Requirements confirmed.',
      ),
    ),
    skipSetupStep: operation(project.extend({ step: SetupStepIdSchema }).strict(), (p) =>
      guideChange(
        engine,
        p.projectId,
        () => skipSetupStep(engine, p.projectId, p.step),
        p.step === 'first-check' ? 'First check put off for later.' : 'Optional extras skipped.',
      ),
    ),
    testAppUrl: operation(z.object({ url: z.string().min(1).max(2000) }).strict(), (p) =>
      testAppUrl(p.url),
    ),
  };
}
