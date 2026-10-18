import type { GuideAction, SetupStepId } from '../../contracts/src/guide.js';
import { publicError } from '../../runtimes/src/index.js';
import type { Engine } from './engine.js';
import { readSetupState, writeSetupState } from './guide-context.js';
import { answerGuideClarification, requireGuideScope } from './guide-scope.js';
import { configureGuideVerification } from './guide-verification.js';
import { editIntent, startLook } from './look.js';
import { readAppUrl, saveVerificationSettings } from './verification-settings.js';

/** Steps a person may put off; the requirements and a verification method are always needed. */
const skippable = new Set<SetupStepId>(['first-check', 'extras']);

/** Record that the person confirmed the requirements Aiden currently holds. */
export async function confirmRequirements(engine: Engine, projectId: string): Promise<void> {
  await requireGuideScope(engine, projectId);
  const { baseline } = await engine.state(projectId);
  if (!baseline) throw new Error('Aiden is still writing the requirements.');
  const state = await readSetupState(engine.store, projectId);
  await writeSetupState(engine.store, projectId, {
    ...state,
    baselineId: baseline.id,
    requirementsConfirmedAt: new Date().toISOString(),
  });
}

/** Put off a deferrable setup step; required steps cannot be skipped. */
export async function skipSetupStep(
  engine: Engine,
  projectId: string,
  step: SetupStepId,
): Promise<void> {
  if (!skippable.has(step))
    throw new Error('This setup step is needed before Aiden can check the work.');
  const state = await readSetupState(engine.store, projectId);
  if (state.skipped.includes(step)) return;
  await writeSetupState(engine.store, projectId, { ...state, skipped: [...state.skipped, step] });
}

/** Apply one action and describe what changed, in words the thread records as an event. */
async function applyOne(
  engine: Engine,
  projectId: string,
  action: GuideAction,
  answer?: string,
): Promise<string> {
  switch (action.type) {
    case 'answer-clarification':
      if (!answer) throw new Error('An explicit answer is required.');
      return answerGuideClarification(engine, projectId, action.callId, answer);
    case 'confirm-requirements':
      await confirmRequirements(engine, projectId);
      return 'Requirements confirmed.';
    case 'save-web-check': {
      await configureGuideVerification(engine, projectId, { url: action.url }, true);
      const saved = await readAppUrl(engine, projectId);
      return `Web check saved for ${saved.url ?? action.url}.`;
    }
    case 'save-api-check':
      await configureGuideVerification(
        engine,
        projectId,
        {
          api: { url: action.url, allowMutations: action.allowMutations, keyHeader: 'X-API-Key' },
        },
        true,
      );
      return `API check saved for ${action.url}${action.allowMutations ? ', with writes allowed' : ', read only'}.`;
    case 'set-manual':
      await saveVerificationSettings(engine, projectId, { manual: action.manual });
      return action.manual ? 'Manual checking turned on.' : 'Manual checking turned off.';
    case 'update-intent':
      await editIntent(engine, projectId, { context: action.context });
      return 'Intent updated. Aiden is rewriting the requirements.';
    case 'run-check':
      await requireGuideScope(engine, projectId);
      await startLook(engine, projectId, 'you');
      return 'Check started.';
    case 'skip-step':
      await skipSetupStep(engine, projectId, action.step);
      return `Setup step skipped: ${action.step}.`;
  }
}

/**
 * Apply the Guide's setup changes in order. A change that fails is reported in the thread and the
 * rest still run, so one unreachable URL does not lose a confirmed requirement.
 * Example: a saved web URL and a started check return two event lines.
 */
export async function applyGuideActions(
  engine: Engine,
  projectId: string,
  actions: GuideAction[],
  answer?: string,
): Promise<string[]> {
  const events: string[] = [];
  for (const action of actions) {
    try {
      events.push(await applyOne(engine, projectId, action, answer));
    } catch (error) {
      events.push(`Could not apply ${action.type}: ${publicError(error)}`);
    }
  }
  return events;
}
