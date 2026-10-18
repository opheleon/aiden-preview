import { type JSX, useState } from 'react';

import type { DesktopBridge } from '../bridge';

/** Explain TestFlight access and distinguish hosted manual testing from supported Aiden automation. */
export function PhoneInstructions({ api }: { api: DesktopBridge | undefined }): JSX.Element {
  const [linkError, setLinkError] = useState('');
  /** Open the provider's setup guide only when the customer explicitly requests it. */
  async function openGuide(): Promise<void> {
    setLinkError('');
    try {
      await api?.openExternal('https://www.browserstack.com/docs/app-live/app-source/testflight');
    } catch {
      setLinkError(
        'Could not open the guide. Visit BrowserStack Docs, then App Live > Install via TestFlight.',
      );
    }
  }
  return (
    <aside className="phone-instructions" aria-label="How iPhone testing works">
      <h3>Use the app you already test in TestFlight</h3>
      <p>
        Ask your app’s owner for a TestFlight invitation and a test account for the app. Accept the
        invitation with your Apple account so the build is available to you. You do not need to
        request a separate .app file or simulator build for TestFlight testing.
      </p>
      <details>
        <summary>No phone to connect? Test on a hosted iPhone</summary>
        <p>
          BrowserStack App Live lets you interact with a real iPhone from your desktop browser. You
          need access to that service, your TestFlight invitation, and your app’s test account. Your
          own phone does not need to stay connected.
        </p>
        <ol>
          <li>Sign in to BrowserStack App Live and choose “Install via TestFlight”.</li>
          <li>Choose one of the supported iPhones shown by the service.</li>
          <li>
            Sign in to TestFlight on that hosted phone with the Apple account that accepted your
            invitation, then install your app.
          </li>
          <li>
            Open the app, sign in with its test account, and check the version and build you want to
            test. You can now tap and interact with the phone through your browser.
          </li>
          <li>End the hosted session when you finish testing.</li>
        </ol>
        <p>
          <strong>This is manual testing outside Aiden today.</strong> Aiden cannot yet open or
          control that hosted session, import its results, or start it from a TestFlight link. “Run
          verification now” below uses the connected-phone configuration, not BrowserStack.
        </p>
        <button type="button" disabled={!api} onClick={() => void openGuide()}>
          Read BrowserStack’s TestFlight instructions
        </button>
        {linkError && <p role="alert">{linkError}</p>}
      </details>
      <h4>Run automated checks in Aiden today</h4>
      <p>
        The phone controls below use an iPhone connected to this Mac. Keep it plugged in by USB and
        unlocked, and leave Aiden open. Hosted-phone automation is not connected yet.
      </p>
      <ol>
        <li>
          <strong>Get the connection ready once.</strong> Open “Connect your iPhone: shared setup”
          below. Your iOS developer may need to help with the Mac tools and Apple permissions.
        </li>
        <li>
          <strong>Install your beta.</strong> Open TestFlight on the connected iPhone, install the
          build, and sign in to your app with the test account. Keep Apple sign-in details on the
          phone; these settings do not need your password.
        </li>
        <li>
          <strong>Choose the app.</strong> Select your iPhone and installed app below. Use “Refresh
          phones and apps” if needed, then “Check phone connection”. This opens the app and checks
          access without running requirement tests or using your model allowance.
        </li>
        <li>
          <strong>Verify.</strong> Allow interaction with the test account, choose when to verify,
          and save. On a saved project, “Run verification now” assesses the code and then checks the
          selected app. During initial project setup, choose “After every successful code
          assessment” if app checks should follow the first assessment automatically.
        </li>
      </ol>
      <details>
        <summary>What happens during a test?</summary>
        <p>
          You will see the app open and move on the phone. Leave that phone available to Aiden;
          using it or switching apps can interrupt the check. A spare test phone is useful if you
          need to keep using your everyday phone. The Mac test windows stay hidden, but the real
          phone screen stays active.
        </p>
        <p>
          Tests can create or change data in the signed-in account. Aiden keeps the app installed
          and preserves its data between checks. In this project’s Verification page, “Device tests”
          shows progress, “Stop test” ends a running check, and “Open evidence report” shows the
          results and screenshots. Stopping a test does not undo changes already made in the app.
        </p>
        <p>
          Automatic checks still need this Mac running Aiden and the phone available. Choosing a
          schedule does not give Aiden a cloud phone. Repository assessment and installed-app
          results remain separate; a detected version and build do not prove which code was shipped.
        </p>
      </details>
    </aside>
  );
}
