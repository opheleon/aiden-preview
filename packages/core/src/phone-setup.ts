import path from 'node:path';

import {
  type PhoneReadiness,
  type PhoneSetup,
  PhoneSetupSchema,
} from '../../contracts/src/phone-setup.js';
import {
  discoverPhoneApps,
  discoverPhones,
  phoneCommand,
} from '../../verification/src/phone-discovery.js';
import { atomic, optionalJson } from './storage.js';

/** Local prerequisite discovery and shared signing preferences, independent of project repositories. */
export class PhoneConnectionSetup {
  /** Allow diagnostic adapters in tests without claiming live hardware evidence. */
  constructor(
    private root: string,
    private command = phoneCommand,
    private phones = discoverPhones,
    readonly apps = discoverPhoneApps,
  ) {}
  /** Load shared signing preferences; absent configuration uses the installed driver's defaults. */
  async read(): Promise<PhoneSetup> {
    return PhoneSetupSchema.parse(
      (await optionalJson(path.join(this.root, 'phone-setup.json'))) ?? {},
    );
  }
  /** Save only validated signing identifiers, never certificates, keys, or Apple account credentials. */
  async save(input: unknown): Promise<PhoneSetup> {
    const settings = PhoneSetupSchema.parse(input);
    await atomic(path.join(this.root, 'phone-setup.json'), settings);
    return settings;
  }
  /** Check prerequisites independently so a missing dependency cannot hide the remaining setup steps. */
  async inspect(): Promise<PhoneReadiness> {
    const [xcode, appium, driver, phones] = await Promise.allSettled([
      this.command('/usr/bin/xcrun', ['--find', 'devicectl']),
      this.command('appium', ['--version']),
      this.command('appium', ['driver', 'list', '--installed', '--json']),
      this.phones(),
    ]);
    let driverReady = false;
    if (driver.status === 'fulfilled') {
      try {
        const data: unknown = JSON.parse(driver.value);
        driverReady = typeof data === 'object' && data !== null && 'xcuitest' in data;
      } catch {
        /* Malformed output is not a successful diagnostic. */
      }
    }
    return {
      settings: await this.read(),
      phones: phones.status === 'fulfilled' ? phones.value : [],
      checks: [
        {
          name: 'Xcode',
          ready: xcode.status === 'fulfilled',
          message:
            xcode.status === 'fulfilled'
              ? 'Apple device tools found.'
              : 'Install full Xcode, open it to finish setup, and select it in Xcode Settings > Locations > Command Line Tools.',
        },
        {
          name: 'Appium',
          ready: appium.status === 'fulfilled',
          message:
            appium.status === 'fulfilled'
              ? 'Installed. Aiden starts and stops its own local connection when needed.'
              : 'Install Appium with Node.js, then restart Aiden so it can find appium on PATH.',
        },
        {
          name: 'iPhone driver',
          ready: driverReady,
          message: driverReady
            ? 'XCUITest installed.'
            : 'Install the XCUITest driver using appium driver install xcuitest.',
        },
        {
          name: 'Phone discovery',
          ready: phones.status === 'fulfilled' && phones.value.length > 0,
          message:
            phones.status === 'fulfilled' && phones.value.length > 0
              ? 'Choose a paired phone below. Connecting checks automation and signing.'
              : 'Connect an iPhone by USB, unlock it, trust this Mac, and enable Developer Mode. Discovery needs iOS 17+ and Xcode 15+.',
        },
      ],
    };
  }
}
