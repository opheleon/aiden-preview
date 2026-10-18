import { z } from 'zod/v3';

import { type DeviceTarget, DeviceTargetSchema } from '../../contracts/src/device-verification.js';
import type { PhoneSetup } from '../../contracts/src/phone-setup.js';

const envelope = z.object({ value: z.unknown() });
const sessionReply = z.object({
  sessionId: z.string().min(1),
  capabilities: z.record(z.unknown()),
});
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

/** Minimal W3C transport, scoped to a local server and one existing iPhone app. */
export class AppiumDevice {
  private sessionId = '';
  metadata: Record<string, string> = {};
  /** Keep cancellation and HTTP injection outside model-visible tool arguments. */
  constructor(
    readonly target: DeviceTarget,
    private signal: AbortSignal,
    private http = fetch,
    private signing: PhoneSetup = {},
  ) {
    DeviceTargetSchema.parse(target);
  }
  /** Bound response size, time, and redirects; server errors never echo app contents or credentials. */
  private async request(
    method: string,
    route: string,
    body?: unknown,
    cleanup = false,
  ): Promise<unknown> {
    const response = await this.http(`${this.target.serverUrl.replace(/\/$/, '')}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: cleanup
        ? AbortSignal.timeout(10000)
        : AbortSignal.any([this.signal, AbortSignal.timeout(90000)]),
    });
    if (!response.ok)
      throw new Error(
        `Device command failed (HTTP ${response.status}). Check Appium and the phone connection.`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Appium returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 12_000_000) throw new Error('Appium response exceeds the evidence limit.');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const { value } = envelope.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (value && typeof value === 'object' && 'error' in value)
      throw new Error(
        'Appium could not complete the command. Check device setup or observe again.',
      );
    return value;
  }
  /** Start without installing, resetting, or rebuilding the distributed app. */
  async open(): Promise<void> {
    const reply = sessionReply.parse(
      await this.request('POST', '/session', {
        capabilities: {
          alwaysMatch: {
            platformName: 'iOS',
            ...(this.signing.teamId
              ? {
                  'appium:xcodeOrgId': this.signing.teamId,
                  'appium:xcodeSigningId': 'Apple Development',
                }
              : {}),
            ...(this.signing.runnerBundleId
              ? { 'appium:updatedWDABundleId': this.signing.runnerBundleId }
              : {}),
            'appium:automationName': 'XCUITest',
            'appium:udid': this.target.udid,
            'appium:bundleId': this.target.bundleId,
            'appium:noReset': true,
            'appium:fullReset': false,
            'appium:autoLaunch': false,
            'appium:newCommandTimeout': 180,
          },
        },
      }),
    );
    this.sessionId = reply.sessionId;
    try {
      const installed = await this.mobile('isAppInstalled', { bundleId: this.target.bundleId });
      if (installed !== true)
        throw new Error('Install this app through TestFlight on the selected phone first.');
      await this.mobile('activateApp', { bundleId: this.target.bundleId });
      await this.assertApp();
      for (const key of ['deviceName', 'platformVersion', 'platformName']) {
        const value = reply.capabilities[key] ?? reply.capabilities[`appium:${key}`];
        if (typeof value === 'string') this.metadata[key] = value;
      }
      this.metadata.deviceId = this.target.udid;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  /** Send an internal, fixed-route session command; never expose this directly to a model. */
  command(method: string, route: string, body?: unknown): Promise<unknown> {
    if (!this.sessionId) throw new Error('The phone session is not open.');
    return this.request(method, `/session/${encodeURIComponent(this.sessionId)}${route}`, body);
  }
  /** Invoke only commands selected by trusted session code. */
  mobile(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.command('POST', '/execute/sync', { script: `mobile: ${name}`, args: [args] });
  }
  /** Refuse interaction or capture after the foreground moves outside the selected app. */
  async assertApp(): Promise<void> {
    const app = z.object({ bundleId: z.string() }).parse(await this.mobile('activeAppInfo', {}));
    if (app.bundleId !== this.target.bundleId)
      throw new Error(
        'The selected app is no longer in front. Return to it on the phone, then start a new check.',
      );
  }
  /** Read the native accessibility hierarchy; absence leaves screenshot interaction available. */
  async source(): Promise<string> {
    return z
      .string()
      .parse(await this.command('GET', '/source'))
      .slice(0, 24000);
  }
  /** Capture PNG bytes and reject invalid or oversized image payloads. */
  async screenshot(): Promise<Buffer> {
    const value = z
      .string()
      .min(1)
      .max(11_000_000)
      .regex(/^[A-Za-z0-9+/=\r\n]+$/)
      .parse(await this.command('GET', '/screenshot'));
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('The phone did not return a PNG screenshot.');
    return bytes;
  }
  /** Resolve exactly one visible accessibility name or identifier; ambiguity requires another observation. */
  async element(name: string): Promise<string> {
    const matches = z.array(z.record(z.string())).parse(
      await this.command('POST', '/elements', {
        using: 'accessibility id',
        value: name,
      }),
    );
    if (matches.length !== 1 || !matches[0]?.[elementKey])
      throw new Error(
        'The element is missing or ambiguous. Observe again or use the screenshot fallback.',
      );
    return encodeURIComponent(matches[0][elementKey]);
  }
  /** Release automation even after cancellation, preserving the installed app and its data. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    const id = this.sessionId;
    await this.request('DELETE', `/session/${encodeURIComponent(id)}`, undefined, true);
    this.sessionId = '';
  }
}
