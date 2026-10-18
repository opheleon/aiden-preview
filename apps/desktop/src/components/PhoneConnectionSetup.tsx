import { type JSX, useState } from 'react';

import type { PhoneReadiness } from '../../../../packages/contracts/src/phone-setup';
import type { DesktopBridge } from '../bridge';

/** Shared prerequisites and optional Apple signing preferences, reused by every project. */
export function PhoneConnectionSetup({
  api,
  status,
  refresh,
}: {
  api: DesktopBridge | undefined;
  status: PhoneReadiness | undefined;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [team, setTeam] = useState(status?.settings.teamId ?? '');
  const [bundle, setBundle] = useState(status?.settings.runnerBundleId ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  /** Persist only explicit signing identifiers; the Apple account stays in Xcode. */
  async function save(): Promise<void> {
    if (!api) return;
    setBusy(true);
    try {
      await api.request('savePhoneSetup', {
        ...(team.trim() ? { teamId: team.trim() } : {}),
        ...(bundle.trim() ? { runnerBundleId: bundle.trim() } : {}),
      });
      setMessage(
        'Connection setup saved for all projects. Use Check phone connection to test the Apple setup.',
      );
    } catch {
      setMessage(
        'Could not save. Use a 10-character Apple team ID and a valid helper app identifier.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="phone-setup">
      <summary>Connect your iPhone: shared setup</summary>
      <p>
        This is a one-time setup for this Mac and phone, shared by your projects. Aiden can check
        what is installed, but it does not install these tools or approve Apple permissions for you.
        You need full Xcode 15 or later on the Mac and iOS 17 or later for the phone and app
        pickers.
      </p>
      <ol>
        <li>
          <strong>Install Apple’s device tools.</strong> Install Xcode from the Mac App Store, open
          it, and finish its setup prompts. In Xcode Settings, under Locations, select the installed
          Xcode in “Command Line Tools”. Xcode supplies the tools that communicate with your phone;
          you do not need to rebuild your TestFlight app.
        </li>
        <li>
          <strong>Install the phone-control tools.</strong> Appium is the local service Aiden uses
          to control the phone; XCUITest is its iPhone driver. If they are missing, ask your
          developer to install Appium and the XCUITest driver for this Mac. Restart Aiden afterward.
          Once installed, Aiden starts and stops its own connection for each managed test.
        </li>
        <li>
          <strong>Let this Mac access the phone.</strong> Connect it with a USB cable, unlock it,
          and tap “Trust” if the phone asks whether to trust this computer. Open Xcode’s device
          window and let pairing finish. On the phone, enable Developer Mode under Settings &gt;
          Privacy &amp; Security, and follow its restart and confirmation prompts. Enable UI
          Automation under Settings &gt; Developer if that option is shown.
        </li>
        <li>
          <strong>Authorize the testing helper.</strong> Apple requires a signed helper app called
          WebDriverAgent on the phone so it can accept automated taps. This is separate from your
          TestFlight app. Your developer may need to set up its Apple signing in Xcode; see “Apple
          signing” below. Having a TestFlight build alone does not complete this step.
        </li>
      </ol>
      <p>
        Choose “Check setup again” after completing these steps. “Found” means a prerequisite was
        detected, not that the phone is ready for a full test. Choose your phone and app, then use
        “Check phone connection” to check the helper and app together.
      </p>
      {status?.checks.map((check) => (
        <p key={check.name}>
          <strong>
            {check.name}: {check.ready ? 'Found' : 'Needs setup'}
          </strong>
          <br />
          {check.message}
        </p>
      ))}
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        Check setup again
      </button>
      <details>
        <summary>Apple signing</summary>
        <p>
          This part may need help from your iOS developer. Add your Apple account in Xcode and
          configure WebDriverAgent to run on this phone with your development team. The two fields
          below pass your developer’s signing choices to Aiden; entering them alone does not create
          the certificates or permissions. Leave them empty only if your existing driver setup
          already supplies signing.
        </p>
        <label>
          Apple development team ID
          <input value={team} maxLength={10} onChange={(e) => setTeam(e.target.value)} />
        </label>
        <label>
          Automation helper identifier
          <input
            value={bundle}
            placeholder="com.yourteam.WebDriverAgentRunner"
            onChange={(e) => setBundle(e.target.value)}
          />
        </label>
        <p>
          Ask your developer for the 10-character team ID and the helper’s app identifier. The
          helper identifier belongs to WebDriverAgent, not the TestFlight app you want to test.
          Aiden saves these identifiers for all projects; your Apple account and certificates stay
          in Xcode.
        </p>
        <button type="button" disabled={busy || !api} onClick={() => void save()}>
          Save shared connection setup
        </button>
        {message && <p role="status">{message}</p>}
      </details>
    </details>
  );
}
