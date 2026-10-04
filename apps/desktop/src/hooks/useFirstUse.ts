import { useEffect, useState } from 'react';

import type { DesktopBridge } from '../bridge';
import type { FirstUseState } from '../first-use';

/** Window-local presentation and explicit actions around durable completion. */
export interface FirstUseController {
  loading: boolean;
  open: boolean;
  state: FirstUseState;
  saving: boolean;
  error: string;
  confirm: () => Promise<void>;
  show: () => void;
  dismiss: () => void;
}

/** One guide instance per window; dismissal is session-only and only confirmation persists completion. */
export function useFirstUse(api: DesktopBridge | undefined): FirstUseController {
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FirstUseState>({ completed: false, issue: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!api?.getFirstUseState) {
      setLoading(false);
      return;
    }
    void api
      .getFirstUseState()
      .catch((): FirstUseState => ({ completed: false, issue: 'unavailable' }))
      .then((value) => {
        if (cancelled) return;
        setState(value);
        setOpen(!value.completed);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);
  /** Persist explicit final acknowledgement before closing; write failure leaves the guide usable. */
  async function confirm(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (!api) throw new Error('Open Aiden in the desktop app to save your confirmation.');
      const result = await api.completeFirstUse();
      if (!result.completed) throw new Error('Your confirmation was not saved. Please retry.');
      setState(result);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save confirmation. Please retry.',
      );
    } finally {
      setSaving(false);
    }
  }
  return {
    loading,
    open,
    state,
    saving,
    error,
    confirm,
    show: () => {
      setError('');
      setOpen(true);
    },
    dismiss: () => {
      if (!saving) setOpen(false);
    },
  };
}
