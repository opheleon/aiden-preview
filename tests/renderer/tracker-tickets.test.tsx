import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { TicketPublishing } from '../../apps/desktop/src/components/TicketPublishing';
import { useTrackerTickets } from '../../apps/desktop/src/hooks/useTrackerTickets';
import type { Workspace } from '../../apps/desktop/src/hooks/useWorkspace';
import type { TicketState } from '../../packages/contracts/src/tickets';

const local: TicketState = { settings: null, records: [] };
const linked: TicketState = {
  settings: {
    enabled: true,
    destination: {
      provider: 'linear',
      connectionId: 'synthetic',
      team: 'Books',
      project: 'Library',
    },
    tools: { create: 'save_issue', update: 'save_issue', get: 'get_issue', search: 'list_issues' },
    fingerprint: 'a'.repeat(64),
  },
  records: [
    {
      featureId: 'F-1',
      title: 'Read books',
      marker: 'synthetic',
      state: 'synced',
      issueId: 'BOOK-1',
      remoteStatus: 'Todo',
    },
  ],
};
function fixture() {
  const call = vi.fn().mockResolvedValue(local);
  const workspace = {
    call,
    project: { id: 'p' },
    busy: false,
    integrations: [],
    setSettingsTab: vi.fn(),
    setArea: vi.fn(),
  } as unknown as Workspace;
  return { call, workspace };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('publishing replaces an older status read immediately and sync applies read-back observations', async () => {
  const f = fixture();
  const older = deferred<TicketState>();
  f.call.mockReturnValueOnce(older.promise);
  const { result } = renderHook(() => useTrackerTickets(f.workspace));
  act(() => result.current.saved(linked));
  await act(async () => {
    older.resolve(local);
    await older.promise;
  });
  expect(result.current.state).toEqual(linked);
  const updated = {
    ...linked,
    checkedAt: '2026-10-03T12:00:00Z',
    records: [{ ...linked.records[0]!, remoteStatus: 'Done' }],
  };
  f.call.mockResolvedValueOnce(updated);
  await act(() => result.current.sync());
  expect(f.call).toHaveBeenLastCalledWith('syncTickets', { projectId: 'p' });
  expect(result.current.state).toEqual(updated);
});

test('a pending sync cannot overwrite another project and duplicate clicks are coalesced', async () => {
  const f = fixture();
  const pending = deferred<TicketState>();
  const { result, rerender } = renderHook(({ workspace }) => useTrackerTickets(workspace), {
    initialProps: { workspace: f.workspace },
  });
  await waitFor(() => expect(result.current.state).toEqual(local));
  f.call.mockReturnValueOnce(pending.promise);
  let sync!: Promise<void>;
  act(() => {
    sync = result.current.sync();
  });
  expect(result.current.syncing).toBe(true);
  const savePreviousProject = result.current.saved;
  await act(() => result.current.sync());
  expect(f.call.mock.calls.filter(([method]) => method === 'syncTickets')).toHaveLength(1);
  rerender({ workspace: { ...f.workspace, project: { ...f.workspace.project, id: 'other' } } });
  await waitFor(() => expect(result.current.state).toEqual(local));
  await act(async () => {
    pending.resolve(linked);
    await sync;
  });
  expect(result.current.state).toEqual(local);
  expect(result.current.syncing).toBe(false);
  act(() => savePreviousProject(linked));
  expect(result.current.state).toEqual(local);
});

test('sync failures preserve linked tickets and can be retried; active runs defer publishing', async () => {
  const f = fixture();
  f.call.mockResolvedValue(linked);
  const { result, rerender } = renderHook(({ workspace }) => useTrackerTickets(workspace), {
    initialProps: { workspace: f.workspace },
  });
  await waitFor(() => expect(result.current.state).toEqual(linked));
  f.call.mockRejectedValueOnce(new Error('Tracker offline'));
  await act(() => result.current.sync());
  expect(result.current.state?.records).toEqual(linked.records);
  expect(result.current.state?.error).toBe('Tracker offline');
  await act(() => result.current.sync());
  expect(result.current.state?.error).toBeUndefined();
  rerender({ workspace: { ...f.workspace, busy: true } });
  const count = f.call.mock.calls.length;
  await act(() => result.current.sync());
  expect(f.call).toHaveBeenCalledTimes(count);
});

test('local requirements expose connection setup and existing issues expose sync without hiding conflicts', async () => {
  const f = fixture();
  const tracker = {
    state: local,
    syncing: false,
    sync: vi.fn().mockResolvedValue(undefined),
    saved: vi.fn(),
  };
  const { rerender } = render(<TicketPublishing workspace={f.workspace} tracker={tracker} />);
  await userEvent.click(screen.getByRole('button', { name: 'Connect tracker' }));
  await userEvent.click(screen.getByRole('button', { name: 'Manage tracker connections' }));
  expect(f.workspace.setSettingsTab).toHaveBeenCalledWith('integrations');
  expect(f.workspace.setArea).toHaveBeenCalledWith('settings');
  rerender(
    <TicketPublishing
      workspace={f.workspace}
      tracker={{
        ...tracker,
        state: { ...linked, records: [{ ...linked.records[0]!, state: 'conflict' }] },
      }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('1 ticket(s) need attention');
  await userEvent.click(screen.getByRole('button', { name: 'Sync tickets' }));
  expect(tracker.sync).toHaveBeenCalledOnce();
});

test('a feature removed from the plan is named with a link to the preserved issue', () => {
  const f = fixture();
  const tracker = { state: linked, syncing: false, sync: vi.fn(), saved: vi.fn() };
  const retired = {
    ...linked.records[0]!,
    featureId: 'F-4',
    title: '[Blocked] Enforce link expiry',
    state: 'retired' as const,
    issueId: 'BOOK-4',
    url: 'https://linear.app/synthetic/issue/BOOK-4',
  };
  const { rerender } = render(
    <TicketPublishing
      workspace={f.workspace}
      tracker={{ ...tracker, state: { ...linked, records: [retired] } }}
    />,
  );
  const note = screen.getByText(/Removed from the plan/);
  expect(note).toHaveTextContent(
    'Removed from the plan: F-4 Enforce link expiry. Aiden kept BOOK-4 for review; close it in the tracker if the work is no longer needed.',
  );
  expect(screen.getByRole('link', { name: 'BOOK-4' })).toHaveAttribute('href', retired.url);
  const unpublished = {
    featureId: retired.featureId,
    title: retired.title,
    marker: retired.marker,
    state: retired.state,
  };
  rerender(
    <TicketPublishing
      workspace={f.workspace}
      tracker={{ ...tracker, state: { ...linked, records: [unpublished] } }}
    />,
  );
  expect(screen.getByText(/Removed from the plan/)).toHaveTextContent(
    'Aiden kept its tracker issue',
  );
});
