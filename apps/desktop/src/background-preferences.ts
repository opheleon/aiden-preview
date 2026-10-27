import { homedir } from 'node:os';
import path from 'node:path';

import { z } from 'zod/v3';

import { atomic, optionalJson } from '../../../packages/core/src/storage.js';

/** Command-line flag the login item passes, so a login start opens without a window. */
export const backgroundFlag = '--background';

const BackgroundPreferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Start Aiden when the person signs in to the computer. On by default. */
    openAtLogin: z.boolean(),
    /** The one-time "still running" notice was shown. */
    noticeShown: z.boolean(),
  })
  .strict();

/** Saved background preferences for this installation. */
export type BackgroundPreferences = z.infer<typeof BackgroundPreferencesSchema>;

/** Where the preferences live inside the Aiden data folder. */
function preferencesFile(dataRoot: string): string {
  return path.join(dataRoot, 'preferences', 'background.json');
}

/** Saved preferences; a missing or corrupt file reads as the defaults (open at login on). */
export async function readBackgroundPreferences(dataRoot: string): Promise<BackgroundPreferences> {
  const parsed = BackgroundPreferencesSchema.safeParse(
    await optionalJson(preferencesFile(dataRoot)).catch(() => null),
  );
  return parsed.success ? parsed.data : { schemaVersion: 1, openAtLogin: true, noticeShown: false };
}

/** Change preferences and return the saved result. */
export async function saveBackgroundPreferences(
  dataRoot: string,
  patch: Partial<Omit<BackgroundPreferences, 'schemaVersion'>>,
): Promise<BackgroundPreferences> {
  const next = BackgroundPreferencesSchema.parse({
    ...(await readBackgroundPreferences(dataRoot)),
    ...patch,
  });
  await atomic(preferencesFile(dataRoot), next);
  return next;
}

/** Whether this launch came from the login item, which passes the background flag. */
export function launchedInBackground(argv: readonly string[]): boolean {
  return argv.includes(backgroundFlag);
}

/** Quote one Exec argument as the freedesktop Desktop Entry specification requires. */
function execArgument(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`;
}

/**
 * The XDG autostart entry that starts Aiden in the background at login on Linux, where Electron
 * has no login item API. `executable` is the AppImage path when there is one, since the
 * extracted binary moves on every run.
 * Example: `autostartEntry('/home/dana/Aiden.AppImage')`.
 */
export function autostartEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Aiden',
    'Comment=Pick up Aiden Teams work in the background',
    `Exec=${execArgument(executable)} ${backgroundFlag}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** The autostart file path, honoring XDG_CONFIG_HOME. */
export function autostartFile(env: NodeJS.ProcessEnv = process.env): string {
  const config = env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(config, 'autostart', 'ai.opheleon.aiden.desktop');
}
