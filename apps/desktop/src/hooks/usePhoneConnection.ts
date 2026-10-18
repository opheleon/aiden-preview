import { useEffect, useRef, useState } from 'react';

import type { PhoneApp, PhoneReadiness } from '../../../../packages/contracts/src/phone-setup';
import type { DesktopBridge } from '../bridge';
import type { VerificationDraft } from '../renderer/verification-config';

/** Renderer-only discovery and transient connection feedback. */
type PhoneConnection = {
  status: PhoneReadiness | undefined;
  apps: PhoneApp[];
  error: string;
  message: string;
  busy: boolean;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
};
/** Discover local phone choices and track connection feedback only for the current target. */
export function usePhoneConnection(
  value: VerificationDraft,
  api: DesktopBridge | undefined,
): PhoneConnection {
  const [status, setStatus] = useState<PhoneReadiness>();
  const [apps, setApps] = useState<PhoneApp[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let closed = false;
    void api
      ?.request('phoneSetup', {})
      .then((result) => {
        if (!closed) setStatus(result);
      })
      .catch(() => {
        if (!closed)
          setError('Could not discover phones. Open shared setup or use Advanced settings.');
      });
    return () => {
      closed = true;
    };
  }, [api]);
  useEffect(() => {
    let closed = false;
    setApps([]);
    setMessage('');
    setError('');
    if (value.udid && value.connection === 'managed') {
      void api
        ?.request('phoneApps', { udid: value.udid })
        .then((result) => {
          if (!closed) setApps(result);
        })
        .catch(() => {
          if (!closed)
            setError('Could not list apps. Unlock the phone, check shared setup, then refresh.');
        });
    }
    return () => {
      closed = true;
      generation.current++;
    };
  }, [api, value.udid, value.bundleId, value.connection]);
  /** Refresh hardware and installed apps without selecting a different target or authorizing interactions. */
  async function refresh(): Promise<void> {
    if (!api) return;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await api.request('phoneSetup', {});
      if (current === generation.current) setStatus(result);
      const installed = value.udid ? await api.request('phoneApps', { udid: value.udid }) : [];
      if (current === generation.current) {
        setStatus(result);
        setApps(installed);
      }
    } catch {
      if (current === generation.current)
        setError('Discovery failed. Check shared setup and unlock the phone.');
    } finally {
      setBusy(false);
    }
  }
  /** Open only the selected app, then release automation; this spends no model allowance. */
  async function connect(): Promise<void> {
    if (!api) return;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const device = await api.request('deviceProbe', {
        serverUrl: value.serverUrl,
        udid: value.udid,
        bundleId: value.bundleId,
        connection: value.connection,
      });
      if (current === generation.current)
        setMessage(
          `Connected to ${device.deviceName ?? value.deviceName ?? 'iPhone'}. The installed app is open.`,
        );
    } catch {
      if (current === generation.current)
        setError(
          'Could not connect. Unlock the phone and check shared setup, including Apple signing.',
        );
    } finally {
      setBusy(false);
    }
  }
  return { status, apps, error, message, busy, refresh, connect };
}
