import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Windows must exercise the production execFile path, without enabling shell execution.
// This test-only native wrapper inherits the pipes and puts its child in a kill-on-close job.
const windowsLauncher = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
class FixtureLauncher {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")]
  static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint size);
  [DllImport("kernel32.dll")]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  static string Quote(string arg) {
    var value = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      value.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
      value.Append(c);
      slashes = 0;
    }
    return value.Append('\\', slashes * 2).Append('"').ToString();
  }
  static int Main(string[] args) {
    var config = File.ReadAllLines(Process.GetCurrentProcess().MainModule.FileName + ".args")
      .Select(line => Encoding.UTF8.GetString(Convert.FromBase64String(line))).ToArray();
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, x64 layout; LimitFlags at offset 16.
    IntPtr limits = Marshal.AllocHGlobal(144);
    Marshal.Copy(new byte[144], 0, limits, 144);
    Marshal.WriteInt32(limits, 16, 0x2000); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, limits, 144)) return 125;
    Marshal.FreeHGlobal(limits);
    using (var child = Process.Start(new ProcessStartInfo(config[0],
      string.Join(" ", config.Skip(1).Concat(args).Select(Quote))) {
        UseShellExecute = false, CreateNoWindow = true
      })) {
      if (!AssignProcessToJobObject(job, child.Handle)) { child.Kill(); return 126; }
      child.WaitForExit();
      int code = child.ExitCode;
      CloseHandle(job);
      return code;
    }
  }
}
`;
let compiled: Promise<string> | undefined;

async function compileWindowsLauncher() {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-fixture-launcher-'));
  const source = path.join(root, 'launcher.cs');
  const binary = path.join(root, 'launcher.exe');
  await writeFile(source, windowsLauncher);
  const compiler = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  execFileSync(compiler, ['/nologo', '/platform:x64', `/out:${binary}`, source]);
  return binary;
}

/** Create a native executable fixture on Windows and an exec wrapper on POSIX. */
export async function executableFixture(destination: string, args: string[]) {
  if (process.platform === 'win32') {
    const binary = `${destination}.exe`;
    compiled ??= compileWindowsLauncher();
    await copyFile(await compiled, binary);
    await writeFile(
      `${binary}.args`,
      args.map((arg) => Buffer.from(arg).toString('base64')).join('\n'),
    );
    return binary;
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await writeFile(destination, '#!/bin/sh\nexec ' + args.map(quote).join(' ') + ' "$@"\n', {
    mode: 0o755,
  });
  return destination;
}

/** Copy a fixture installation, including the Windows launch arguments. */
export async function copyExecutableFixture(source: string, destination: string) {
  await copyFile(source, destination);
  if (process.platform === 'win32') await copyFile(`${source}.args`, `${destination}.args`);
}
