import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import { DeviceTargetSchema } from '../../contracts/src/device-verification.js';
import type { PhoneApp, PhoneChoice } from '../../contracts/src/phone-setup.js';
import { cleanEnvironment } from '../../runtimes/src/environment.js';

const exec = promisify(execFile);
/** Run a fixed diagnostic command without a shell or inherited provider secrets. */
export async function phoneCommand(binary: string, args: string[]): Promise<string> {
  const result = await exec(binary, args, {
    env: cleanEnvironment(),
    cwd: os.tmpdir(),
    timeout: 25000,
    maxBuffer: 2_000_000,
  });
  return result.stdout;
}
/** Read bounded devicectl JSON from a private temporary directory and always remove it. */
async function deviceInfo(args: string[]): Promise<unknown> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'aiden-phone-'));
  const file = path.join(folder, 'result.json');
  try {
    await phoneCommand('/usr/bin/xcrun', ['devicectl', ...args, '--json-output', file]);
    if ((await stat(file)).size > 2_000_000)
      throw new Error('Device discovery response is too large.');
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
const deviceRow = z.object({
  hardwareProperties: z.object({ udid: z.string(), deviceType: z.string().optional() }),
  deviceProperties: z.object({
    name: z.string(),
    osVersionNumber: z.string().optional(),
    developerModeStatus: z.string().optional(),
  }),
  connectionProperties: z
    .object({ pairingState: z.string().optional(), tunnelState: z.string().optional() })
    .optional(),
});
/** Ignore simulators and malformed device entries; keep unavailable paired phones visible. */
export function parsePhones(input: unknown): PhoneChoice[] {
  const rows = z.object({ result: z.object({ devices: z.array(z.unknown()) }) }).parse(input)
    .result.devices;
  return rows.flatMap((row) => {
    const parsed = deviceRow.safeParse(row);
    if (!parsed.success) return [];
    const d = parsed.data;
    if (
      !DeviceTargetSchema.shape.udid.safeParse(d.hardwareProperties.udid).success ||
      d.hardwareProperties.deviceType !== 'iPhone'
    )
      return [];
    const state =
      d.deviceProperties.developerModeStatus === 'disabled'
        ? 'Enable Developer Mode on this phone'
        : d.connectionProperties?.pairingState !== 'paired'
          ? 'Pair and trust this computer in Xcode'
          : 'Paired; unlock to connect';
    return [
      {
        udid: d.hardwareProperties.udid,
        name: d.deviceProperties.name,
        version: d.deviceProperties.osVersionNumber ?? '',
        state,
      },
    ];
  });
}
/** Extract installed app identity and build without trusting arbitrary output fields. */
export function parsePhoneApps(input: unknown): PhoneApp[] {
  const rows = z.object({ result: z.object({ apps: z.array(z.unknown()) }) }).parse(input)
    .result.apps;
  const app = z.object({
    bundleIdentifier: DeviceTargetSchema.shape.bundleId,
    name: z.string().max(300),
    version: z.string().max(100).optional(),
    bundleVersion: z.string().max(100).optional(),
  });
  return rows
    .flatMap((row) => {
      const result = app.safeParse(row);
      if (!result.success) return [];
      const a = result.data;
      return [
        {
          bundleId: a.bundleIdentifier,
          name: a.name,
          version: a.version ?? '',
          build: a.bundleVersion ?? '',
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** Discover paired physical phones using Apple's local tooling, without opening their apps. */
export async function discoverPhones(): Promise<PhoneChoice[]> {
  return parsePhones(await deviceInfo(['list', 'devices']));
}
/** Enumerate apps on one validated phone; no install, launch, reset, or provider call occurs. */
export async function discoverPhoneApps(udid: string): Promise<PhoneApp[]> {
  DeviceTargetSchema.shape.udid.parse(udid);
  try {
    return parsePhoneApps(await deviceInfo(['device', 'info', 'apps', '--device', udid]));
  } catch {
    throw new Error(
      'Could not read installed apps. Unlock the paired iPhone, enable Developer Mode, and check Xcode. Discovery requires iOS 17 or later.',
    );
  }
}
