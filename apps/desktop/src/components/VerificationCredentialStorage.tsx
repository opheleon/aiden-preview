import type { JSX } from 'react';

import type { VerificationDraft } from '../renderer/verification-config';

/** Let users choose persistence and make the memory-only fallback explicit. */
export function VerificationCredentialStorage({
  value,
  patch,
}: {
  value: VerificationDraft;
  patch: (update: Partial<VerificationDraft>) => void;
}): JSX.Element | null {
  if (!value.api && !(value.browser && value.webLogin)) return null;
  return (
    <div className="verification-credential-storage">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.rememberCredentials}
          onChange={(event) => patch({ rememberCredentials: event.target.checked })}
        />
        Remember test credentials on this device
      </label>
      <p className="guide-card-note">
        {!value.rememberCredentials
          ? 'Credentials stay in memory until Aiden closes. You will need to enter them again next time.'
          : value.credentialStorage === 'session'
            ? 'Secure storage was unavailable. Credentials are in memory for this session only. You will need to enter them again after Aiden closes.'
            : 'Saved in your device’s secure storage. Your device may ask permission to save or unlock these test credentials.'}
      </p>
    </div>
  );
}
