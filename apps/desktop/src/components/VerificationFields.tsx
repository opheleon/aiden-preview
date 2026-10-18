import type { JSX } from 'react';

import type { DesktopBridge } from '../bridge';
import type { VerificationDraft } from '../renderer/verification-config';
import { phoneVerificationVisible } from '../renderer/verification-features';
import { PhoneFields } from './PhoneFields';
import { VerificationAuthFields } from './VerificationAuthFields';
import { VerificationCredentialStorage } from './VerificationCredentialStorage';

/** Shared project setup and settings controls for supported surfaces and their prerequisites. */
export function VerificationFields({
  value,
  api,
  onChange,
  disabled = false,
}: {
  api?: DesktopBridge | undefined;
  value: VerificationDraft;
  onChange: (next: VerificationDraft) => void;
  disabled?: boolean;
}): JSX.Element {
  /** Apply a field change while retaining all other selected surface settings. */
  function patch(update: Partial<VerificationDraft>): void {
    onChange({ ...value, ...update });
  }
  return (
    <fieldset disabled={disabled} className="verification-fields">
      <legend>Surfaces to verify</legend>
      <p>
        Repository and code assessment is always included. Choose the running surfaces Aiden should
        check against the same requirements.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.browser}
          onChange={(e) => patch({ browser: e.target.checked })}
        />
        Browser app (desktop web)
      </label>
      {value.browser && (
        <label>
          App URL
          <input
            type="url"
            value={value.url}
            placeholder="https://beta.example.com"
            onChange={(e) => patch({ url: e.target.value })}
          />
        </label>
      )}
      {value.browser && (
        <p>
          Have the app running at this address. Browser sign-in uses the private test credentials
          configured on this computer. Never put passwords or tokens in these fields.
        </p>
      )}
      {value.browser && <VerificationAuthFields surface="web" value={value} patch={patch} />}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.api}
          onChange={(e) => patch({ api: e.target.checked, writes: false })}
        />
        API
      </label>
      {value.api && (
        <>
          <label>
            API base URL
            <input
              type="url"
              value={value.apiUrl}
              placeholder="https://beta.example.com/api/"
              onChange={(e) => patch({ apiUrl: e.target.value, writes: false })}
            />
          </label>
          <VerificationAuthFields surface="api" value={value} patch={patch} />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={value.writes}
              onChange={(e) => patch({ writes: e.target.checked })}
            />
            Allow writes to this disposable test API
          </label>
          <p>
            Without write permission, checks are read-only. Start the API and prepare any test
            fixtures before verification.
          </p>
        </>
      )}
      <VerificationCredentialStorage value={value} patch={patch} />
      {phoneVerificationVisible() && (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={value.phone}
              onChange={(e) => patch({ phone: e.target.checked, interactions: false })}
            />
            iPhone app (installed TestFlight build)
          </label>
          {value.phone && <PhoneFields value={value} patch={patch} api={api} />}
        </>
      )}
      <label>
        When to verify
        <select
          value={value.trigger}
          onChange={(e) => patch({ trigger: e.target.value as VerificationDraft['trigger'] })}
        >
          <option value="manual">Manually, when I run verification</option>
          <option value="after_assessment">After every successful code assessment</option>
        </select>
      </label>
      <p>
        {value.trigger === 'after_assessment'
          ? 'Automatic checks include the initial assessment and later checks started by you or project monitoring while Aiden is open. Keep selected surfaces available. Checks use your chosen model allowance and may create test data.'
          : 'Saving this configuration does not start app verification. Run verification now when your test environments are ready.'}
      </p>
      <p>
        Android and native desktop apps are not supported yet. A desktop website uses the browser
        surface.
      </p>
    </fieldset>
  );
}
