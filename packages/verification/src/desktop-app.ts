import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import {
  type DesktopApp,
  DesktopAppSchema,
  type DesktopReadiness,
} from '../../contracts/src/desktop-verification.js';
import { cleanEnvironment } from '../../runtimes/src/environment.js';

const run = promisify(execFile);
const lineLimit = 20_000_000;

/** One accessible element, valid until the next observation; frames are relative to the app window. */
export const DesktopElementSchema = z
  .object({
    id: z.number().int().positive(),
    role: z.string().max(80),
    name: z.string().max(300),
    value: z.string().max(300).optional(),
    enabled: z.boolean(),
    secure: z.boolean().optional(),
    frame: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  })
  .strict();
/** An element the model may act on by id. */
export type DesktopElement = z.infer<typeof DesktopElementSchema>;

/** What the helper saw: the app's window, its elements, and a PNG of that window only. */
export const DesktopObservationSchema = z
  .object({
    app: z.string().max(300),
    window: z.string().max(300),
    foreground: z.boolean(),
    elements: z.array(DesktopElementSchema).max(400),
    screenshot: z.string().max(lineLimit),
  })
  .strict();

/** Keys the model may press; anything else is refused before it reaches the app. */
export const DesktopKeySchema = z.enum([
  'Enter',
  'Tab',
  'Escape',
  'Space',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
]);

/** Every operation the helper accepts. No shell, file, install, or other-app operation exists. */
export type DesktopRequest =
  | { op: 'open' }
  | { op: 'identity' }
  | { op: 'observe' }
  | { op: 'click'; element: number }
  | { op: 'click_point'; x: number; y: number }
  | { op: 'type'; element: number; text: string }
  | { op: 'key'; key: z.infer<typeof DesktopKeySchema> }
  | { op: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; element?: number };

const ResponseSchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), data: z.unknown().optional() }).strict(),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string().max(500) }).strict(),
]);

/** Locate Aiden's native helpers: bundled resources when packaged, the build output in development. */
export function nativeRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AIDEN_NATIVE_PATH) return env.AIDEN_NATIVE_PATH;
  // Source runs from the repository; compiled code runs from dist. Both use dist/native.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  return path.join(path.basename(root) === 'dist' ? root : path.join(root, 'dist'), 'native');
}

/** The command that starts the helper for this operating system. */
function helper(native: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32')
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(native, 'windows', 'desktop.ps1'),
        ...args,
      ],
    };
  return { file: path.join(native, 'macos', 'aiden-desktop'), args };
}

/** Whether Aiden can read and drive installed apps here, and what the person must allow. */
export async function desktopReadiness(native = nativeRoot()): Promise<DesktopReadiness> {
  if (process.platform === 'win32') {
    const ready = existsSync(path.join(native, 'windows', 'desktop.ps1'));
    const checks = [
      {
        name: 'Desktop helper',
        ready,
        message: ready ? 'Included with Aiden.' : 'Reinstall Aiden.',
      },
    ];
    return { ready, checks };
  }
  if (process.platform !== 'darwin')
    return {
      ready: false,
      checks: [{ name: 'Operating system', ready: false, message: 'Use macOS or Windows.' }],
    };
  const file = path.join(native, 'macos', 'aiden-desktop');
  if (!existsSync(file))
    return {
      ready: false,
      checks: [
        {
          name: 'Desktop helper',
          ready: false,
          message: 'Missing. Reinstall Aiden, or run "pnpm native:build" in development.',
        },
      ],
    };
  const { stdout } = await run(file, ['check'], { env: cleanEnvironment(), timeout: 10000 });
  const state = z
    .object({ accessibility: z.boolean(), screenCapture: z.boolean() })
    .parse(JSON.parse(stdout));
  const checks = [
    {
      name: 'Accessibility',
      ready: state.accessibility,
      message: state.accessibility
        ? 'Allowed.'
        : 'Allow Aiden in System Settings > Privacy & Security > Accessibility so it can read and press controls in the app you choose.',
    },
    {
      name: 'Screen Recording',
      ready: state.screenCapture,
      message: state.screenCapture
        ? 'Allowed.'
        : 'Allow Aiden in System Settings > Privacy & Security > Screen Recording so it can capture the window of the app you choose.',
    },
  ];
  return { ready: checks.every((c) => c.ready), checks };
}

/** Ask macOS to show its permission prompts; the person still decides in System Settings. */
export async function requestDesktopAccess(native = nativeRoot()): Promise<void> {
  if (process.platform !== 'darwin') return;
  await run(path.join(native, 'macos', 'aiden-desktop'), ['request'], {
    env: cleanEnvironment(),
    timeout: 10000,
  });
}

/** Installed apps the person can choose from; macOS only. */
export async function installedApps(native = nativeRoot()): Promise<DesktopApp[]> {
  if (process.platform !== 'darwin') return [];
  const { stdout } = await run(path.join(native, 'macos', 'aiden-desktop'), ['apps'], {
    env: cleanEnvironment(),
    timeout: 30000,
    maxBuffer: 5_000_000,
  });
  return z.array(DesktopAppSchema).max(2000).parse(JSON.parse(stdout));
}

/** A helper process bound to one installed app; requests are answered in order. */
export class DesktopAppSession {
  private next = 0;
  private waiting = new Map<number, (line: unknown) => void>();
  private exited = false;
  /** Start the helper for one app path; it cannot be pointed at another app later. */
  static start(appPath: string, native = nativeRoot()): DesktopAppSession {
    const command = helper(native, ['drive', '--app', appPath]);
    return new DesktopAppSession(
      spawn(command.file, command.args, {
        env: cleanEnvironment(),
        stdio: ['pipe', 'pipe', 'ignore'],
      }),
    );
  }
  /** Wrap a running helper process that speaks the line protocol. */
  constructor(private child: ChildProcess) {
    createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (line) =>
      this.receive(line),
    );
    child.once('exit', () => {
      this.exited = true;
      for (const resolve of this.waiting.values()) resolve(null);
      this.waiting.clear();
    });
  }
  /** Route one response line to the request waiting for it. */
  private receive(line: string): void {
    if (line.length > lineLimit) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== 'number') return;
    this.waiting.get(id)?.(parsed);
    this.waiting.delete(id);
  }
  /** Send one operation and wait for its answer; failed actions become thrown errors. */
  async request(body: DesktopRequest, signal: AbortSignal, timeoutMs = 30000): Promise<unknown> {
    if (this.exited) throw new Error('The desktop helper stopped. Start the test again.');
    const id = ++this.next;
    const answer = new Promise<unknown>((resolve) => this.waiting.set(id, resolve));
    this.child.stdin!.write(JSON.stringify({ id, ...body }) + '\n');
    const limit = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const aborted = new Promise<never>((_, reject) =>
      limit.addEventListener('abort', () => reject(new Error('The app did not answer in time.')), {
        once: true,
      }),
    );
    const raw = await Promise.race([answer, aborted]).finally(() => this.waiting.delete(id));
    signal.throwIfAborted();
    if (raw === null) throw new Error('The desktop helper stopped. Start the test again.');
    const response = ResponseSchema.parse(raw);
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }
  /** Stop the helper; the app itself stays open for the person. */
  close(): void {
    this.child.stdin?.end();
    if (!this.exited) setTimeout(() => this.child.kill(), 2000).unref();
  }
}
