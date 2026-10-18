import type { JSX } from 'react';

import type { VerificationDraft } from '../renderer/verification-config';

/** Private form values live only in component memory and travel directly to the local worker. */
export function VerificationAuthFields({
  surface,
  value,
  patch,
}: {
  surface: 'web' | 'api';
  value: VerificationDraft;
  patch: (update: Partial<VerificationDraft>) => void;
}): JSX.Element {
  if (surface === 'api')
    return (
      <>
        <label>
          API key header
          <select
            value={value.apiKeyHeader}
            onChange={(event) =>
              patch({ apiKeyHeader: event.target.value as VerificationDraft['apiKeyHeader'] })
            }
          >
            <option value="X-API-Key">X-API-Key</option>
            <option value="Authorization">Authorization: Bearer</option>
          </select>
        </label>
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={value.apiKey}
            placeholder={
              value.apiKeyConfigured ? 'Saved key; enter to replace' : 'Enter a test API key'
            }
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </label>
        <p className="guide-card-note">
          API keys only. The key is kept outside the chat and sent in this header. Choose a
          protected API address that rejects requests without a key.
        </p>
      </>
    );
  return (
    <>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.webLogin}
          onChange={(event) => patch({ webLogin: event.target.checked })}
        />
        Sign in before testing
      </label>
      {value.webLogin && (
        <>
          <label>
            Login page URL
            <input
              type="url"
              value={value.loginUrl}
              placeholder="http://localhost:3000/login"
              onChange={(event) => patch({ loginUrl: event.target.value })}
            />
          </label>
          <label>
            Test account email
            <input
              autoComplete="off"
              value={value.username}
              placeholder={
                value.webCredentialsConfigured
                  ? 'Saved account; enter to replace'
                  : 'test@example.com'
              }
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
          <label>
            Test account password
            <input
              type="password"
              autoComplete="new-password"
              value={value.password}
              placeholder={
                value.webCredentialsConfigured
                  ? 'Saved password; enter to replace'
                  : 'Enter the test password'
              }
              onChange={(event) => patch({ password: event.target.value })}
            />
          </label>
          <p className="guide-card-note">
            Use the signed-in page as the app URL. Aiden checks the page and session automatically.
            Your password stays private; recording starts after sign-in. Supports a same-origin
            email/password form with session cookies.
          </p>
        </>
      )}
    </>
  );
}
