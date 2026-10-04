import { useEffect, useRef, useState } from 'react';

import type { TicketState } from '../../../../packages/contracts/src/tickets';
import type { Workspace } from './useWorkspace';

/** Project-scoped observations and explicit publication through the worker's guarded reconciler. */
export interface TrackerTickets {
  state: TicketState | null;
  syncing: boolean;
  sync: () => Promise<void>;
  saved: (value: TicketState) => void;
}

/** Keep observations current without allowing stale reads to replace a publish or project switch. */
export function useTrackerTickets(workspace: Workspace): TrackerTickets {
  const [state, setState] = useState<{ projectId: string; value: TicketState } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const activeProject = useRef('');
  const { call, project, report, baseline } = workspace;
  useEffect(() => {
    const epoch = ++generation.current;
    activeProject.current = project.id;
    pending.current = false;
    setSyncing(false);
    let reading = false;
    /** Read persisted status only; automatic remote checks belong to the worker. */
    const read = async () => {
      if (reading || pending.current) return;
      reading = true;
      const version = generation.current;
      try {
        const next = await call('ticketState', { projectId: project.id });
        if (generation.current === version && next)
          setState({ projectId: project.id, value: next });
      } catch {
        if (generation.current === version)
          setState((previous) => ({
            projectId: project.id,
            value: {
              ...(previous?.projectId === project.id
                ? previous.value
                : { settings: null, records: [] }),
              error: 'Could not load tracker tickets.',
            },
          }));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => {
      activeProject.current = '';
      generation.current = Math.max(generation.current, epoch) + 1;
      clearInterval(timer);
    };
  }, [call, project.id, report?.id, baseline?.id]);
  /** Apply read-back results immediately and invalidate older polling responses. */
  const saved = (value: TicketState) => {
    if (activeProject.current !== project.id) return;
    generation.current++;
    setState({ projectId: project.id, value });
  };
  /** Reconcile existing identities, publishing missing tickets and preserving human edits. */
  const sync = async () => {
    if (pending.current || workspace.busy) return;
    const version = ++generation.current;
    pending.current = true;
    setSyncing(true);
    try {
      const next = await call('syncTickets', { projectId: project.id });
      if (generation.current === version) setState({ projectId: project.id, value: next });
    } catch (error) {
      if (generation.current === version)
        setState((previous) => ({
          projectId: project.id,
          value: {
            ...(previous?.projectId === project.id
              ? previous.value
              : { settings: null, records: [] }),
            error: error instanceof Error ? error.message : 'Could not sync tickets. Try again.',
          },
        }));
    } finally {
      if (generation.current === version) {
        pending.current = false;
        setSyncing(false);
      }
    }
  };
  return { state: state?.projectId === project.id ? state.value : null, syncing, sync, saved };
}
