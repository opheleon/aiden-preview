# Local authentication example

Run `pnpm demo:auth` from the repository with its pinned Node version. Open <http://127.0.0.1:4317/login>. The server binds only to your computer, and the frontend forms submit to a real backend using SQLite. Notes persist across restarts in `.aiden/local-auth-demo/demo.sqlite`.

These are public, disposable example credentials, never credentials for a real account:

| Setting               | Value                    |
| --------------------- | ------------------------ |
| Test account email    | `demo@local.test`        |
| Test account password | `local-demo-password-42` |
| Test API key          | `local-demo-api-key-42`  |

## Set up Aiden

Open the project's setup chat and select Web app and API. iPhone setup is temporarily hidden; its implementation and existing configuration remain available internally.

For Web app, enter `http://127.0.0.1:4317/app`, enable **Sign in before testing**, and enter:

- Login page URL: `http://127.0.0.1:4317/login`
- The disposable account above.

For API, enter `http://127.0.0.1:4317/api/`, choose **X-API-Key**, and enter the disposable key. Enable test writes only when testing note creation. New API setup supports API keys; legacy stored authentication remains compatible.

For a disposable local test, uncheck **Remember test credentials on this device** to avoid OS credential prompts and keep the values only in memory. Click **Check access**, then **Confirm setup**. Aiden must sign in, find the protected page, and reuse the session in a fresh browser context. For API setup, the endpoint must reject a missing key and accept the supplied key. Bad credentials leave the previous settings unchanged.

## What is exercised

The frontend supports sign-in, saving notes, reloading notes from SQLite, and sign-out. The backend hashes passwords with salted scrypt, stores hashed session tokens, scopes notes to the signed-in user, parameterizes SQL, escapes rendered text, checks form origins, and issues HttpOnly, SameSite cookies. The local HTTP example is for development, not production deployment.

The API exposes `GET /api/`, `GET /api/notes`, and `POST /api/notes` with a JSON `text` field. It accepts the key through `X-API-Key` or `Authorization: Bearer`. Missing or invalid keys receive 401, independently of browser cookies.

Aiden's private login runs before recording and model observations. Only in-memory cookies enter the recorded browser session; password-typing tools are unavailable there. Remembered private setup values use the OS credential store; otherwise they stay in worker memory until Aiden quits. Public settings files omit the values. Legacy plaintext settings migrate on their next load. Removing the login/API setup or closing with **Forget saved test credentials** clears the corresponding saved values. This first implementation supports same-origin email/password forms with cookie sessions; MFA, external identity providers, and local-storage sessions need separate support. An application could still display sensitive data after login, so use a disposable account.

`tests/local-auth.test.ts` exercises the actual local server, SQLite, Chromium, setup checks, and Aiden browser/API tools. Desktop journeys use synthetic model replies and real worker operations. Credential storage tests use a synthetic native-store adapter, and the desktop authentication journey uses memory-only storage and verifies that credentials are unavailable after restarting. These tests do not claim a live provider/model run or native credential-store validation on every supported platform.
