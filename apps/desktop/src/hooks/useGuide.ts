import { useCallback, useEffect, useRef, useState } from 'react';

import type { GuideView, SetupStepId } from '../../../../packages/contracts/src/guide';
import type { Workspace } from './useWorkspace';

/** The project Guide as the chat uses it: the saved thread and checklist, plus its actions. */
export type Guide = {
  view: GuideView | null;
  thinking: boolean;
  /** What the reply in progress is doing, such as "Listing acme's repositories on GitHub". */
  doing: string;
  /** A message sent but not answered yet, shown until the reply arrives. */
  asking: string;
  error: string;
  /** A first scope draft exists and the Guide has not introduced its questions or review yet. */
  ready: boolean;
  /** Play back the requirements once; the chat calls it when it comes on screen. */
  playback: () => void;
  ask: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  confirm: () => Promise<void>;
  answer: (callId: string, answer: string) => Promise<void>;
  skip: (step: SetupStepId) => Promise<void>;
  reload: () => Promise<void>;
};

/** Turn an unknown failure into a sentence for the thread. */
const message = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/**
 * The step a Guide reply in progress is on, such as a GitHub lookup, from the worker's guide
 * events for the open project. It clears whenever a reply starts or ends.
 * @param current The open project's ID, read when each event arrives.
 * @param thinking Whether a reply is being written now.
 */
function useGuideSteps(current: React.RefObject<string>, thinking: boolean): string {
  const [doing, setDoing] = useState('');
  useEffect(() => setDoing(''), [thinking]);
  useEffect(
    () =>
      window.aiden?.onEvent((event) => {
        if (event.type === 'guide' && event.projectId === current.current)
          setDoing(event.message ?? '');
      }),
    [current],
  );
  return doing;
}

/**
 * Load and drive a project's Guide. The thread reloads when runs change so finished checks show up,
 * and the chat starts the first playback once Aiden has written the requirements and the Guide is
 * on screen, so opening a project never spends a turn by itself.
 * Example: a new project shows "Thinking", then plays back the requirements.
 */
export function useGuide(workspace: Workspace): Guide {
  const { call, project, projects, baseline, runs } = workspace;
  const projectId = project.id;
  const saved = projects.some((p) => p.id === projectId);
  const [view, setView] = useState<GuideView | null>(null);
  const [thinking, setThinking] = useState(false);
  const [asking, setAsking] = useState('');
  const [error, setError] = useState('');
  const kicked = useRef(new Set<string>());
  const current = useRef(projectId);
  current.current = projectId;
  const doing = useGuideSteps(current, thinking);
  const runKey = runs.map((r) => `${r.id}:${r.status}`).join(',');

  useEffect(() => {
    setView(null);
    setError('');
    setAsking('');
    setThinking(false);
  }, [projectId]);

  useEffect(() => {
    if (!saved) return;
    let closed = false;
    void call('guide', { projectId })
      .then((next) => {
        if (!closed) setView(next);
      })
      .catch((e: unknown) => {
        if (!closed) setError(message(e, 'Could not load the Guide.'));
      });
    return () => {
      closed = true;
    };
  }, [call, projectId, saved, runKey, baseline?.id, workspace.area]);

  /** Run one Guide request, keeping its result only if the person is still on this project. */
  const turn = useCallback(
    async (
      request: () => Promise<GuideView>,
      pending = '',
      fallback = 'The Guide could not answer.',
    ) => {
      const id = current.current;
      setThinking(true);
      setAsking(pending);
      setError('');
      try {
        const next = await request();
        if (current.current === id) setView(next);
      } catch (e) {
        if (current.current !== id) return;
        setError(message(e, fallback));
        // The person's message was saved before the model ran; show it with Ask again.
        setView(await call('guide', { projectId: id }).catch(() => null));
      } finally {
        if (current.current === id) {
          setThinking(false);
          setAsking('');
        }
      }
    },
    [call],
  );

  const ready = !!view && !!baseline && !view.thread.messages.some((m) => m.from === 'aiden');

  return {
    view,
    thinking,
    doing,
    asking,
    error,
    reload: async () => {
      try {
        const next = await call('guide', { projectId });
        if (current.current === projectId) setView(next);
      } catch (e) {
        if (current.current === projectId) setError(message(e, 'Could not load the Guide.'));
      }
    },
    ready,
    playback: () => {
      if (!ready || thinking || kicked.current.has(projectId)) return;
      kicked.current.add(projectId);
      void turn(() => call('askGuide', { projectId, kickoff: true }));
    },
    ask: (text) => turn(() => call('askGuide', { projectId, text }), text),
    retry: () => turn(() => call('askGuide', { projectId, retry: true })),
    answer: (callId, answer) =>
      turn(
        () =>
          call('askGuide', {
            projectId,
            clarification: { callId, answer },
          }),
        answer,
      ),
    confirm: () =>
      turn(async () => {
        await call('confirmRequirements', { projectId });
        return call('askGuide', { projectId, text: 'The requirements look right.' });
      }, 'The requirements look right.'),
    skip: (step) =>
      turn(() => call('skipSetupStep', { projectId, step }), '', 'Could not skip this step.'),
  };
}
