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
    if (['calls', 'activity'].includes(method)) return Promise.resolve([]);
    if (method === 'verification') return Promise.resolve(null);
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

test('project loading restores what Aiden knows without starting work, then validates the handoff', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  await act(() => result.current.load(project.id));
  expect(result.current.project).toEqual(project);
  expect(result.current.busy).toBe(false);
  expect(f.request).toHaveBeenCalledWith('calls', { projectId: project.id });
  expect(f.request).toHaveBeenCalledWith('activity', { projectId: project.id });
  expect(f.request).not.toHaveBeenCalledWith('look', expect.anything());
  await act(() => result.current.start());
  expect(f.request).toHaveBeenCalledWith('prepare', {
    project: { ...project, name: 'Users can list books' },
    autoAccept: true,
  });
  expect(result.current.activeRun).toBe('fixture-run');
  expect(result.current.busy).toBe(true);
  act(() => result.current.setProject({ ...project, context: ' ' }));
  await act(() => result.current.start());
  expect(result.current.error).toContain('Tell Aiden what you are building');
  expect(result.current.busy).toBe(false);
  act(() => result.current.setProject({ ...project, name: ' ', repositories: [] }));
  await act(() => result.current.start());
  expect(result.current.error).toContain('Choose the project folder');
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

test('worker progress, activity, cancellation, and background outcomes update only their intended state', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  act(() => result.current.setProject(project));
  await waitFor(() => expect(f.api.onEvent).toHaveBeenCalled());
  act(() =>
    f.emit({ type: 'progress', projectId: project.id, runId: 'run', message: 'Inspecting' }),
  );
  expect(result.current.live).toBe('Inspecting');
  expect(result.current.busy).toBe(true);
  const ask = {
    at: '2026-09-29T09:00:00.000Z',
    runId: 'run',
    kind: 'ask' as const,
    summary: 'Asked you: Which branch?',
    reason: 'Going ahead assuming: main',
  };
  await act(async () => {
    f.emit({ type: 'activity', projectId: project.id, runId: 'run', activity: ask });
    f.emit({ type: 'activity', projectId: project.id, runId: 'run', activity: ask });
    f.emit({ type: 'activity', projectId: project.id, runId: 'run' });
    await Promise.resolve();
  });
  expect(result.current.activity).toEqual([ask]);
  expect(result.current.live).toBe('Asked you: Which branch?');
  expect(f.request).toHaveBeenCalledWith('calls', { projectId: project.id });
  await act(async () => {
    f.emit({
      type: 'cancelled',
      projectId: project.id,
      runId: 'run',
      message: 'Cancelled by user',
    });
    await Promise.resolve();
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBe('Cancelled by user');
  act(() => f.emit({ type: 'completed', projectId: 'other', runId: 'other-run' }));
  expect(result.current.notice).toContain('another project');
});

test('answering a call while Aiden works keeps the answer until the current work finishes', async () => {
  const f = desktop();
  f.request.mockImplementation(((method: string) => {
    if (method === 'answerCall') return Promise.resolve({ call: {}, runId: null });
    if (['diagnostics', 'projects', 'integrations', 'calls', 'activity'].includes(method))
      return Promise.resolve([]);
    return Promise.resolve({ runId: 'fixture-run' });
  }) as never);
  const { result } = renderHook(() => useWorkspace());
  act(() => result.current.setProject(project));
  await act(() => result.current.answerCall('call', 'Yes'));
  expect(result.current.notice).toContain('current work finishes');
  expect(result.current.busy).toBe(false);
  f.request.mockRejectedValueOnce(new Error('This call is no longer open.'));
  await act(() => result.current.answerCall('call', 'Yes'));
  expect(result.current.error).toBe('This call is no longer open.');
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

test('a completed look never starts another run on its own', async () => {
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
  expect(f.request).not.toHaveBeenCalledWith('look', expect.anything());
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
  expect(result.current.live).not.toBe('Elsewhere');
});

test('a first progress event fetches the newly started run without changing projects', async () => {
  const f = desktop();
  const { result } = renderHook(() => useWorkspace());
  act(() => result.current.setProject(project));
  const run = {
    id: 'new-run',
    projectId: project.id,
    project,
    kind: 'estimate',
    status: 'running',
    stage: 'estimate',
    createdAt: new Date().toISOString(),
  };
  f.request.mockImplementation((method: string) =>
    Promise.resolve(
      method === 'state' ? { project, runs: [run], activeRunIds: ['new-run'] } : ([] as any),
    ),
  );
  await act(async () => {
    f.emit({ type: 'progress', projectId: project.id, runId: 'new-run', message: 'Sizing' });
    await Promise.resolve();
  });
  expect(result.current.runs).toEqual([run]);
  expect(result.current.activeRuns).toEqual(['new-run']);
});
