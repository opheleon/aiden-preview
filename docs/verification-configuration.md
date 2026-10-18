# Project verification configuration

When code is connected, Aiden assesses it against the accepted project requirements. Verification adds observations from running apps and APIs.

After you start a project, its setup chat asks how to check the work using an inline checklist. Select web, API, code, or manual checking. Initial setup checks access before confirmation. For an existing project, open **Overview → Project connections → Manage**, or **Settings → Project → Edit verification in chat**. **Check access & save** checks the selected targets and saves only if all checks pass. Changed targets require a fresh check; failed checks preserve the saved configuration. iPhone controls are currently hidden while their implementation is retained.

A project without connected code skips the code check. A saved web or API check then runs directly against the app, followed by sizing. Choosing **I'll check it myself** saves manual checking: Aiden lists the tests for you to run and mark done.

## Choose surfaces

- **Web app:** supply the running app URL. Aiden drives the browser and records evidence. A website running on a computer belongs here; native desktop applications are not supported.
- **API:** supply the API base URL. Writes are disabled by default. Enable writes only for a disposable test environment where Aiden may create and change test data. Changing the target clears write consent in the form.
- **iPhone app (currently hidden):** install your existing TestFlight build on the connected phone, then choose that phone and app from the pickers. Allow interaction with the selected test account. Changing the device, app, or server clears consent. The inline instructions cover TestFlight access, first-time setup, and an external hosted-phone option for manual testing. Hosted-phone automation and invitation-link setup are not integrated into Aiden yet. See [iPhone setup](iphone-verification.md).

Unchecked surfaces are removed from the saved configuration. Android and native desktop application automation are not supported yet. Aiden selects relevant requirements and edge cases for verification; hidden behavior cannot be established by a screenshot alone.

## Trigger checks

**Manually** is the default. Saving checks access but does not verify requirements. **Run check now** on Overview checks current repository code and then the configured app/API surfaces, with progress and results in chat.

Expand **Automatic checks** in the connection editor to change the schedule. **After every successful code assessment** adds configured checks to the initial project handoff and subsequent project checks, including checks requested by you or project monitoring while Aiden is open. A failed or cancelled code assessment does not start verification. Keep the browser/API environment running and the phone connected and unlocked. Automatic checks use the selected provider allowance and can act on test data according to the saved permissions.

The existing **Post-merge beta verification** schedule remains separate and is available in **Settings → Project**. It checks deployed browser/API targets after a tracked merge, with deployment revision confirmation. It does not schedule iPhone tests. If both mechanisms are enabled, a project assessment and a later confirmed deployment can each trigger verification.

A stopped or unavailable surface never counts as verified. Code findings remain available. Browser/API results and evidence are in **Activity**, with detailed run records under **All runs**. The retained phone implementation also keeps its evidence reports. Each phone report identifies its code assessment, requirements, and repository commits, but the tester's build label does not attest that those commits are installed.

## Configuration and credentials

Public settings are saved per project in `AIDEN_HOME/projects/<project-id>/verification.json`. Credential values are stored separately in the OS credential store or in worker memory. The settings API returns only configuration and whether credentials are available. Saving a new project writes configuration before its first assessment can start. Existing projects remain in manual mode unless automatic verification is explicitly enabled; existing browser and API URLs are retained.

Enter browser test credentials and API keys in the private setup form. **Remember test credentials on this device** uses the OS credential store. Turn it off to keep credentials only until Aiden quits. If the OS store is unavailable, Aiden falls back to memory and displays that credentials must be entered again after quitting. Existing owner-only files containing plaintext credentials migrate when their verification settings are next loaded; the rewritten file omits the private values. Environment-based `AIDEN_VERIFY_USERNAME` and `AIDEN_VERIFY_PASSWORD` remain supported for legacy checks and are never copied into saved settings. Do not enter passwords or tokens into URLs or build labels. On iPhone, install and sign in manually before starting.

Phone setup now uses phone and installed-app pickers with detected version/build. Technical controls live under **Advanced phone settings**. Shared Mac prerequisites and optional Apple signing identifiers live under **Connect your iPhone: shared setup**; projects retain their own selected phone, app, interaction consent, and verification schedule. New phone configurations use an Aiden-managed local Appium process; older configurations retain their existing server.

## Private login and API keys

New API setup uses a private API key in `X-API-Key` or `Authorization: Bearer`. Setup checks that the protected endpoint rejects a missing key and accepts the supplied key before confirming. The key stays in secure storage or session memory and is represented by an opaque handle in model tools.

For cookie-based web apps, enable **Sign in before testing** and provide a login page, test account, and protected app URL. Aiden inspects the page automatically: it checks that the app requires sign-in, submits the private form in an unrecorded context, and confirms the app opens with usable content and no login or verification-code form in a fresh cookie-only context. No confirmation text is needed. A public page, failed login, unfinished MFA step, or session that cannot be reused will not confirm access. Private values never return in public settings. See the [local authentication example](local-auth-demo.md) for runnable frontend, backend, and SQLite instructions.

The iPhone controls are temporarily hidden. Existing phone configuration and implementation are retained.

During a web check, Aiden can reuse that same account to sign in again after sign-out or session expiry. The model requests a private sign-in without receiving the credentials or choosing their destination. Aiden submits the configured form in a fresh unrecorded browser, transfers only session cookies, and records the resulting app state as evidence. This supports testing sign-in and re-entry, but does not prove that an error on a particular existing login form clears. A different role or an empty account still requires the appropriate test account.

## Forget credentials

Removing a web login or API setup also removes its saved credentials. Changing an app or API origin clears credentials bound to the previous origin. Closing a project offers **Forget saved test credentials**, checked by default. Leave it checked to remove the project's browser password, API key, and any legacy expired test token from memory and secure storage. Reopening then requires fresh credentials. Uncheck it to retain credentials for later use.

Shared connections such as Linear belong to the application, so closing a project does not remove them. Use the connection's **Remove** control to delete its stored sign-in. If secure storage refuses deletion, Aiden reports the failure and keeps the metadata needed for another attempt. A failed project cleanup leaves the project open.

Forgetting project credentials also disables environment credential fallback for that project until fresh private credentials are explicitly supplied. It does not change your environment variables, revoke credentials at their issuer, or erase old backups. A non-secret cleanup marker lets Aiden retry native removal if saving the public settings failed after a credential write.
