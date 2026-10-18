# Test an installed iPhone app

## For product managers: use your existing TestFlight build

Ask the app owner for a TestFlight invitation and an app test account. Accept the invitation with your Apple account. TestFlight testing does not require a separately exported simulator `.app` file.

### Without a connected phone: hosted manual testing

BrowserStack App Live can install TestFlight apps on supported hosted iPhones. This is an external service that requires its own account/access:

1. Sign in to App Live and choose **Install via TestFlight**.
2. Select a supported iPhone from the highlighted devices.
3. Sign in to TestFlight on the hosted phone using the Apple account that accepted your invitation, then install the app.
4. Open the app, sign in with its test account, and confirm the version/build. Interact with the hosted phone through your desktop browser.
5. End the session when you finish.

See [BrowserStack’s TestFlight instructions](https://www.browserstack.com/docs/app-live/app-source/testflight).

This is manual testing outside Aiden today. Aiden does not yet provision or control hosted sessions, import their results, or accept a TestFlight invitation link as an automated test target. The controls in Aiden’s Verification page currently configure a connected iPhone. Automated hosted testing needs a separate integration and validation.

## Automated testing in Aiden today: a connected iPhone

For the guided workflow, keep a real iPhone plugged into the Mac by USB and unlocked while testing. Leave Aiden running. You will see the app move on the phone as Aiden taps, types, swipes, and takes screenshots. Hidden Mac verification windows do not make the phone’s screen headless. Avoid using that phone during a run; a spare test phone is convenient.

1. Install the app from TestFlight yourself and sign in with a test account on the phone.
2. In Aiden’s project setup or Verification page, enable the iPhone surface. Read **Connect your iPhone: shared setup**. Full Xcode, Appium, the XCUITest driver, device trust, Developer Mode, and a signed WebDriverAgent helper are prerequisites. Aiden detects prerequisites but does not install the tools or approve Apple permissions. Your iOS developer may need to complete the helper signing setup.
3. Select the phone and installed app. **Refresh phones and apps** updates those lists. **Check phone connection** opens the selected app and checks the automation connection without running requirement tests or spending model quota. “Found” prerequisite indicators alone do not establish a working connection.
4. Allow interactions with the test account and save the configuration. On a saved project, **Run verification now** starts a code assessment and then checks the configured app surfaces. In initial project setup, select **After every successful code assessment** if app checks should follow that first assessment; manual mode only saves the configuration.
5. Keep the phone connected and available until the run finishes. The Verification page’s **Device tests** section has progress, **Stop test**, and **Open evidence report**. Tests may change app data, which persists between runs; stopping does not undo prior actions.

Apple supports wireless device connections after Xcode pairing, but wireless testing has not been validated in Aiden. Use USB for this guided workflow. See [Apple’s wireless device guide](https://help.apple.com/xcode/mac/current/en.lproj/dev3e2f4ee6d.html). The [Appium device preparation guide](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/) explains device trust, Developer Mode, UI Automation, and the signed helper.

Scheduled phone checks still need this Mac running Aiden and the selected phone available. Aiden does not supply a cloud phone or automatically fetch TestFlight builds.

Aiden can check an app already installed through TestFlight, using a connected iPhone. Phone verification follows the project’s repository and code assessment, using the same accepted requirements and edge cases. The distributed app does not need an instrumented build. This is an initial local-device integration; it does not provision cloud phones or install builds from invitation links.

## Manual connection setup (advanced)

These steps are for **Existing Appium server** mode and the low-level CLI. For **Managed by Aiden**, use the shared setup and phone/app pickers above; Aiden starts the local server for you.

1. Use a Mac with Xcode and a compatible Appium installation with the XCUITest driver. Follow Appium's [device preparation](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/) and [WebDriverAgent signing instructions](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/provisioning-profile/). The automation helper is separate from the distributed app. Aiden does not install Appium or modify signing credentials.
2. Connect and trust the physical iPhone, enable Developer Mode, and keep it unlocked. Obtain its device identifier from Xcode's Devices and Simulators window. Configure signing for WebDriverAgent in your local Appium server's default capabilities.
3. Start Appium bound to loopback, normally `http://127.0.0.1:4723`. Remote servers and URL credentials are not supported in this version.
4. Accept the TestFlight invitation and install the desired build using [Apple's instructions](https://testflight.apple.com/). Open the app, complete permission prompts, and sign in with a disposable test account. Ask the developer for the app's bundle identifier, such as `com.company.notes`.

## Run a test

During project setup, expand **Verification setup: surfaces and connections** and select **iPhone app (installed TestFlight build)**. For an existing project, open **Verification** below its name, or **Settings → Project → Verification configuration**. Choose the phone and installed app; Aiden reads the version/build. If you use an existing Appium server, open **Advanced phone settings** to enter its address and any manual device/app identifiers. **Check phone connection** opens the installed app without submitting a model prompt.

Save the configuration after allowing interaction with the test app/account. Choose **Manually** to run only when requested, or **After every successful code assessment** to include phone checks in the initial assessment and later project checks while Aiden is open. Keep the device ready in automatic mode. **Run verification now** saves the current configuration and starts a fresh repository assessment followed by all selected surfaces. Aiden derives checks from the accepted requirements and edge cases, excluding unresolved decisions, and preserves the project’s model and authentication settings.

See [project verification configuration](verification-configuration.md) for browser/API surfaces, credentials, and post-merge scheduling.

The project’s Runs activity records both phases. Device history and the evidence report link each phone check to its requirement, baseline, code report, and assessed repository commits. Code findings remain intact if the phone is unavailable or a UI result differs. The installed build’s correspondence to assessed commits is explicitly unverified; managed tests record the installed version and build from the phone, while manual connections use the tester’s label. Later code assessments do not make older device evidence current.

The agent sees screenshots and the native accessibility hierarchy. It taps elements by accessibility name where possible and uses fresh screenshot coordinates otherwise. It can type non-secret test text and swipe. App content is evidence, never instructions. A second model turn examines the saved screenshots independently before a result is marked verified or failed.

**Stop test** cancels model work and releases the Appium session. **Open evidence report** opens the saved HTML report. Its adjacent JSON, PNG, and XML files form the evidence bundle; copy the whole run folder to share it. These files may contain visible test-account data and are created with owner-only permissions.

## Limits and evidence

- Install and sign in manually. Apple account authentication, passwords, verification codes, system dialogs, external app handoffs, payments, and account deletion require a person. Aiden stops acting when another app is foreground.
- The named-action guard is best effort. Coordinate taps cannot reliably classify business consequences. Only use a disposable account and test environment authorized for UI interaction.
- Evidence consists of timestamped screenshots and accessibility snapshots after each step, not continuous video. Screenshots cannot establish hidden backend behavior, delivery to another person, or security properties such as encryption at rest.
- The saved build label is not independently attested. Managed tests additionally record version/build metadata read from the phone at connection time. Neither establishes which source commit was shipped. Keep TestFlight automatic updates off during a run.
- App data persists between criteria and runs. Aiden does not uninstall, reinstall, or reset the app, and does not automatically repeat failed actions or test runs. Criteria should describe the required starting state.
- One Aiden run owns a phone at a time. Each criterion has a step budget, and a run has a twenty-minute deadline. A lost connection or unavailable evidence produces an inconclusive or failed run, never an assumed pass.
- After a worker or Mac crash, terminate any surviving Appium session before restarting testing. Aiden keeps the device lock to prevent competing sessions. After confirming no session remains, remove that phone's lock directory under `AIDEN_HOME/device-locks/`. Its name is the SHA-256 of the JSON-encoded device ID. Do not remove a lock while another Aiden worker is using the device.

## Low-level CLI

The CLI below is an independent diagnostic helper with caller-supplied criteria. For the repository assessment workflow, use the project action above.

Use `pnpm cli verify-device --config device-test.json [--out evidence-directory]`. The optional output directory receives the entire evidence bundle. Configuration:

```json
{
  "name": "Notes beta",
  "target": {
    "serverUrl": "http://127.0.0.1:4723",
    "udid": "00008110-0011223344556677",
    "bundleId": "com.company.notes"
  },
  "buildLabel": "1.2 (42)",
  "criteria": ["Create a test note, reopen it, and confirm its text is retained."],
  "runtime": { "provider": "codex", "auth": "subscription" },
  "allowInteractions": true,
  "stepLimit": 25
}
```

For a connection-only check, put just the `target` object in `phone.json` and run `pnpm cli device-probe --config phone.json`. This checks the device and opens the app without spending model quota. Use the existing provider sign-in setup; API-key mode remains an explicit selection.

## Validation status

Automated tests use a synthetic Appium transport and scripted provider output to exercise session lifecycle, interactions, evidence review, cancellation, and the desktop form. They are not evidence of a real TestFlight run. Validate this integration on a paired iPhone with your configured Xcode/Appium versions before relying on its results.

## Simplified connection setup

In project setup or **Verification**, enable the iPhone surface, choose a paired iPhone, and choose its installed app. Aiden reads its version and build using Apple's local device tools. Discovery requires full Xcode 15+ and iOS 17+. The app can be installed through TestFlight; no source build or app instrumentation is required. Aiden checks installed metadata again before each managed verification and records it in the evidence report. Version/build metadata does not prove correspondence to the assessed repository commits.

**Connect your iPhone: shared setup** checks Xcode, Appium, XCUITest, and phone discovery. Install these prerequisites separately; Aiden does not download or install them. Pair and trust the phone, enable Developer Mode, and sign in to the app with a test account. **Apple signing** saves optional development team and helper bundle identifiers in `AIDEN_HOME/phone-setup.json`, shared by every project. Account sign-in, certificates, and provisioning remain in Xcode. **Check phone connection** launches the installed app and tests the signed automation helper without spending model quota. Prerequisite discovery alone does not establish that signing or automation works.

New selections use **Managed by Aiden**: the worker starts an installed Appium executable on an available loopback port with only XCUITest enabled, then stops that owned process after the session, on failure, or during cancellation/shutdown. It uses an isolated temporary configuration and excludes provider credentials from the child environment. It neither adopts nor stops an existing server. Appium must be discoverable on the application's PATH, including standard Homebrew locations; restart Aiden after installing tools.

**Advanced phone settings** retains manual device/app IDs, build labels, action limits, and an existing server option. Previously saved configurations keep using their existing server, with no migration or new signing overrides. Unavailable saved phones remain selected; Aiden never silently switches to another phone or app. Manual connections preserve tester-supplied build labels.
