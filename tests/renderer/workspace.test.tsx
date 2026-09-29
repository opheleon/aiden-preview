import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { DesktopBridge } from '../../apps/desktop/src/bridge';
import { useWorkspace } from '../../apps/desktop/src/hooks/useWorkspace';
import type { Project, RunEvent } from '../../packages/contracts/src/index';

const project: Project = {
  id: 'fixture',
  name: 'Fixture',
  context: 'Users can list books',
  repositories: [{ id: 'repo', path: '/synthetic/repo', notes: 'main' }],
  runtime: { provider: 'codex', auth: 'subscription' },
};
function desktop() {
  let listener: ((event: RunEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const request = vi.fn((method: string) => {
    if (['diagnostics', 'projects', 'integrations'].includes(method)) return Promise.resolve([]);
    if (method === 'state')
      return Promise.resolve({ project, baseline: null, runs: [], activeRunIds: [] });
    if (method === 'estimation') return Promise.resolve(null);
    if (method === 'discoverRepositories')
      return Promise.resolve({
        rootPath: '/synthetic',
        warnings: [],
        repositories: project.repositories,
      });
    return Promise.resolve({ runId: 'fixture-run' });
  });
  const api = {
    request,
    chooseProjectFolder: vi.fn().mockResolvedValue('/synthetic'),
    getUpdateStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
    getUpdatePreferences: vi.fn().mockResolvedValue({ autoDownload: true, channel: 'stable' }),
    setUpdatePreferences: vi.fn().mockImplementation((value: unknown) => Promise.resolve(value)),
    onUpdateStatus: vi.fn(() => unsubscribe),
    onEvent: vi.fn((callback: (event: RunEvent) => void) => {
      listener = callback;
      return unsubscribe;
    }),
  };
  window.aiden = api as unknown as DesktopBridge;
  return { api, request, unsubscribe, emit: (event: RunEvent) => listener!(event) };
}
afterEach(() => {
  delete window.aiden;
  vi.useRealTimers();
});

test('project loading restores saved artifacts without relaunching analysis, then validates explicit preparation', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  await act(() => result.current.load(project.id));
  expect(result.current.project).toEqual(project);
  expect(result.current.showGoalStarter).toBe(false);
  expect(result.current.step).toBe(0);
  expect(f.request).not.toHaveBeenCalledWith('report', expect.anything());
  await act(() => result.current.prepare());
  expect(f.request).toHaveBeenCalledWith('prepare', { project });
  expect(result.current.activeRun).toBe('fixture-run');
  expect(result.current.busy).toBe(true);
  act(() => result.current.setProject({ ...project, context: '' }));
  await act(() => result.current.prepare());
  expect(result.current.error).toContain('Add a project name');
  expect(result.current.busy).toBe(false);
});

test('repository rescans retain notes and cancelling folder selection leaves inputs intact', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  act(() =>
    result.current.setProject({
      ...project,
      rootPath: '/synthetic',
      repositories: [{ ...project.repositories[0]!, notes: 'Reviewed branch notes' }],
    }),
  );
  await act(() => result.current.scanProjectFolder());
  expect(result.current.project.repositories[0]?.notes).toBe('Reviewed branch notes');
  f.api.chooseProjectFolder.mockResolvedValue(null);
  const previous = result.current.project;
  await act(() => result.current.scanProjectFolder(true));
  expect(result.current.project).toBe(previous);
  expect(result.current.scanning).toBe(false);
});

test('changed source inputs block analysis until another requirements review', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  act(() => result.current.setProject({ ...project, context: 'Changed requirements' }));
  await act(() => result.current.analyze());
  expect(result.current.step).toBe(1);
  expect(result.current.error).toContain('inputs have changed');
  expect(f.request).not.toHaveBeenCalledWith('report', expect.anything());
  act(() => result.current.setProject(project));
  await act(() => result.current.analyze());
  expect(f.request).toHaveBeenCalledWith('updateRuntime', {
    projectId: project.id,
    runtime: project.runtime,
  });
  expect(f.request).toHaveBeenCalledWith('report', { projectId: project.id, browserCheck: true });
});

test('worker progress, clarification, review, cancellation, and background outcomes update only their intended state', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  act(() => result.current.setProject(project));
  await waitFor(() => expect(f.api.onEvent).toHaveBeenCalled());
  act(() =>
    f.emit({ type: 'progress', projectId: project.id, runId: 'run', message: 'Inspecting' }),
  );
  expect(result.current.log).toEqual(['Inspecting']);
  expect(result.current.busy).toBe(true);
  act(() =>
    f.emit({
      type: 'clarification',
      projectId: project.id,
      runId: 'run',
      questionId: 'question',
      question: 'Which branch?',
    }),
  );
  expect(result.current.question?.question).toBe('Which branch?');
  act(() =>
    f.emit({
      type: 'review',
      projectId: project.id,
      runId: 'run',
      product: { overview: 'Books', requirements: [], milestones: [] },
    }),
  );
  expect(result.current.reviewRun).toBe('run');
  expect(result.current.step).toBe(2);
  await act(async () => {
    f.emit({
      type: 'cancelled',
      projectId: project.id,
      runId: 'run',
      message: 'Cancelled by user',
    });
    await Promise.resolve();
  });
  expect(result.current.question).toBeUndefined();
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBe('Cancelled by user');
  act(() => f.emit({ type: 'completed', projectId: 'other', runId: 'other-run' }));
  expect(result.current.notice).toContain('background run finished');
});

test('update persistence errors surface and subscriptions clean up', async () => {
  const f = desktop();
  f.api.setUpdatePreferences.mockRejectedValue(new Error('Disk unavailable'));
  const { result, unmount } = renderHook(() => useWorkspace());
  await act(async () => {
    result.current.saveUpdatePreferences({ autoDownload: false, channel: 'beta' });
    await Promise.resolve();
  });
  expect(result.current.error).toBe('Disk unavailable');
  unmount();
  expect(f.unsubscribe).toHaveBeenCalled();
});

test('a completed code assessment never starts an estimate on its own', async () => {
  const f = desktop();
  const { result, unmount } = renderHook(() => useWorkspace());
  act(() => result.current.setProject(project));
  await waitFor(() => expect(f.api.onEvent).toHaveBeenCalled());
  vi.useFakeTimers();
  await act(async () => {
    f.emit({
      type: 'completed',
      projectId: project.id,
      runId: 'report',
      report: { id: 'report' } as NonNullable<RunEvent['report']>,
    });
    await Promise.resolve();
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(result.current.busy).toBe(false);
  expect(f.request).not.toHaveBeenCalledWith('estimate', expect.anything());
  unmount();
});

test('progress from another project never holds this project as busy', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  act(() => result.current.setProject(project));
  await waitFor(() => expect(f.api.onEvent).toHaveBeenCalled());
  act(() =>
    f.emit({ type: 'progress', projectId: 'other', runId: 'other-run', message: 'Elsewhere' }),
  );
  expect(result.current.busy).toBe(false);
  expect(result.current.log).not.toContain('Elsewhere');
});
