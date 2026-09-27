import { useEffect } from 'react';

import type { DesktopBridge } from '../bridge';
import type { UpdatePreferences } from '../updater';
import type { WorkspaceState } from './useWorkspaceState';
/** Synchronize updater state and preferences with the trusted main process. */
export function useWorkspaceUpdates(
  state: WorkspaceState,
  api: DesktopBridge | undefined,
): { saveUpdatePreferences: (next: UpdatePreferences) => void } {
  /** Persist an explicit update preference change and surface storage failures. */
  function saveUpdatePreferences(next: UpdatePreferences): void {
    state.setUpdatePreferences(next);
    void api
      ?.setUpdatePreferences(next)
      .then(state.setUpdatePreferences)
      .catch((cause) =>
        state.setError(
          cause instanceof Error ? cause.message : 'Could not save update preference.',
        ),
      );
  }
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .getUpdateStatus()
      .then((status) => {
        if (!cancelled) state.setUpdateStatus(status);
      })
      .catch(() => {});
    void api
      .getUpdatePreferences()
      .then((preferences) => {
        if (!cancelled) state.setUpdatePreferences(preferences);
      })
      .catch(() => {});
    const unsubscribe = api.onUpdateStatus((status) => {
      if (!cancelled) state.setUpdateStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, state.setUpdateStatus, state.setUpdatePreferences]);
  return { saveUpdatePreferences };
}
