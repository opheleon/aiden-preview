import { useCallback, useEffect } from 'react';

import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type { DesktopBridge } from '../bridge';
import { useIntegrationSignIn } from './useIntegrationSignIn';
import { useWorkspaceEvents } from './useWorkspaceEvents';
import { useWorkspaceState, type WorkspaceState } from './useWorkspaceState';
import { useWorkspaceUpdates } from './useWorkspaceUpdates';
import { type WorkspaceOperations, workspaceOperations } from './workspace-operations';
/** Workspace presentation state plus explicit, typed desktop and worker operations. */
export type Workspace = WorkspaceState &
  WorkspaceOperations &
  ReturnType<typeof useWorkspaceUpdates> & {
    call: DesktopBridge['request'];
    refresh: () => Promise<void>;
  };
/** Compose independent state, lifecycle subscriptions, and explicit user actions. */
export function useWorkspace(): Workspace {
  const state = useWorkspaceState();
  const api = window.aiden;
  const call = useCallback(
    async <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => {
      if (!api) throw new Error('Open Aiden in Electron to connect repositories and run analysis.');
      return api.request(method, params);
    },
    [api],
  );
  const { setDiagnostics, setProjects, setIntegrations, setError } = state;
  const refresh = useCallback(async () => {
    // Projects are local files, but the provider check starts the Codex and Claude CLIs and takes
    // about a second, so each list shows as soon as it arrives instead of waiting on the others.
    await Promise.all([
      call('projects').then(setProjects),
      call('integrations').then(setIntegrations),
      call('diagnostics').then(setDiagnostics),
    ]);
  }, [call, setDiagnostics, setProjects, setIntegrations]);
  useEffect(() => {
    if (api)
      void refresh().catch((error: unknown) =>
        setError(error instanceof Error ? error.message : 'Could not load workspace.'),
      );
  }, [api, refresh, setError]);
  useIntegrationSignIn({ call, integrations: state.integrations, setIntegrations, setError });
  const updates = useWorkspaceUpdates(state, api);
  useWorkspaceEvents(state, api, call);
  return {
    ...state,
    ...workspaceOperations(state, call),
    ...updates,
    call,
    refresh,
  };
}
