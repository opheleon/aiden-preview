import type { JSX } from 'react';

import type { PhoneApp } from '../../../../packages/contracts/src/phone-setup';
import type { DesktopBridge } from '../bridge';
import { usePhoneConnection } from '../hooks/usePhoneConnection';
import type { VerificationDraft } from '../renderer/verification-config';
import { PhoneConnectionSetup } from './PhoneConnectionSetup';
import { PhoneInstructions } from './PhoneInstructions';

/** Choose discovered devices and apps, preserving manual compatibility behind advanced controls. */
export function PhoneFields({
  value,
  patch,
  api,
}: {
  value: VerificationDraft;
  patch: (update: Partial<VerificationDraft>) => void;
  api: DesktopBridge | undefined;
}): JSX.Element {
  const { status, apps, error, message, busy, refresh, connect } = usePhoneConnection(value, api);
  /** Bind the observed app and build to this phone; changing identity requires fresh consent. */
  function selectApp(bundleId: string): void {
    const app = apps.find((a) => a.bundleId === bundleId);
    patch({
      bundleId,
      appName: app?.name ?? '',
      buildLabel: app ? appBuild(app) : '',
      interactions: false,
    });
  }
  const installed = apps.find((app) => app.bundleId === value.bundleId);
  return (
    <fieldset disabled={busy} className="phone-fields">
      <legend>Installed iPhone app</legend>
      <PhoneInstructions api={api} />
      <PhoneConnectionSetup
        key={JSON.stringify(status?.settings)}
        api={api}
        status={status}
        refresh={refresh}
      />
      <label>
        iPhone
        <select
          value={value.udid}
          onChange={(e) => {
            const phone = status?.phones.find((p) => p.udid === e.target.value);
            patch({
              udid: e.target.value,
              deviceName: phone?.name ?? '',
              bundleId: '',
              appName: '',
              buildLabel: '',
              interactions: false,
            });
          }}
        >
          <option value="">Choose a phone</option>
          {value.udid && !status?.phones.some((p) => p.udid === value.udid) && (
            <option value={value.udid}>
              {value.deviceName || 'Saved iPhone'} (not discovered)
            </option>
          )}
          {status?.phones.map((p) => (
            <option key={p.udid} value={p.udid}>
              {p.name} · iOS {p.version} · {p.state}
            </option>
          ))}
        </select>
      </label>
      <label>
        Installed app
        <select
          value={value.bundleId}
          disabled={!value.udid}
          onChange={(e) => selectApp(e.target.value)}
        >
          <option value="">Choose an installed app</option>
          {value.bundleId && !installed && (
            <option value={value.bundleId}>
              {value.appName || value.bundleId} (saved selection)
            </option>
          )}
          {apps.map((a) => (
            <option key={a.bundleId} value={a.bundleId}>
              {a.name} · {a.bundleId}
            </option>
          ))}
        </select>
      </label>
      <PhoneBuild installed={installed} label={value.buildLabel} />
      <div className="button-row">
        <button type="button" disabled={!api} onClick={() => void refresh()}>
          Refresh phones and apps
        </button>
        <button
          type="button"
          disabled={!api || !value.udid || !value.bundleId}
          onClick={() => void connect()}
        >
          Check phone connection
        </button>
      </div>
      <p>
        A successful connection check means the app can be opened and controlled. It does not mean
        its requirements have passed. Managed verification reads the installed build again before
        testing.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <PhoneAdvanced value={value} patch={patch} />
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.interactions}
          onChange={(e) => patch({ interactions: e.target.checked })}
        />
        Allow taps, typing, swipes, and screenshots in this app and test account, including
        automatic checks when enabled.
      </label>
    </fieldset>
  );
}
/** Describe only metadata the phone reports; missing version values remain explicitly unknown. */
function appBuild(app: PhoneApp): string {
  return `${app.version || 'Unknown version'} (${app.build || 'unknown build'})`.slice(0, 120);
}
/** Keep legacy and custom connections editable without crowding the normal phone/app flow. */
function PhoneAdvanced({
  value,
  patch,
}: {
  value: VerificationDraft;
  patch: (update: Partial<VerificationDraft>) => void;
}): JSX.Element {
  return (
    <details>
      <summary>Advanced phone settings</summary>
      <label>
        Phone connection
        <select
          value={value.connection}
          onChange={(e) =>
            patch({ connection: e.target.value as 'managed' | 'manual', interactions: false })
          }
        >
          <option value="managed">Managed by Aiden</option>
          <option value="manual">Existing Appium server</option>
        </select>
      </label>
      <label>
        iPhone device ID
        <input
          value={value.udid}
          onChange={(e) =>
            patch({
              udid: e.target.value,
              deviceName: '',
              bundleId: '',
              appName: '',
              buildLabel: '',
              interactions: false,
            })
          }
        />
      </label>
      <label>
        App identifier
        <input
          value={value.bundleId}
          onChange={(e) => patch({ bundleId: e.target.value, appName: '', interactions: false })}
        />
      </label>
      <label>
        TestFlight version / build
        <input
          value={value.buildLabel}
          maxLength={120}
          onChange={(e) => patch({ buildLabel: e.target.value })}
        />
      </label>
      {value.connection === 'manual' && (
        <label>
          Local Appium address
          <input
            value={value.serverUrl}
            onChange={(e) => patch({ serverUrl: e.target.value, interactions: false })}
          />
        </label>
      )}
      <label>
        Maximum phone actions per criterion
        <input
          type="number"
          min={5}
          max={60}
          value={value.phoneStepLimit}
          onChange={(e) => patch({ phoneStepLimit: Number(e.target.value) })}
        />
      </label>
      <p>
        Existing servers keep their own lifecycle and signing settings. A build label never
        establishes which repository commit was shipped.
      </p>
    </details>
  );
}

/** Distinguish current device metadata from a saved, manually supplied build label. */
function PhoneBuild({
  installed,
  label,
}: {
  installed: PhoneApp | undefined;
  label: string;
}): JSX.Element {
  return (
    <p>
      Build:{' '}
      {installed ? appBuild(installed) : label || 'Choose an app to detect its version and build.'}
      {!installed && label ? ' (saved label; not checked)' : ''}
    </p>
  );
}
