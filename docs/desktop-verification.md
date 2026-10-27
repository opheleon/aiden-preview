# Test an installed desktop app

Aiden can check acceptance criteria against a desktop app already installed on your computer: a macOS app in `/Applications` or a Windows program. Install or update the build you want to test the way you normally would, such as from your beta channel or by using the app's own update control. Aiden then drives that app and records screenshot evidence.

There is no desktop app UI for this yet. Use the CLI commands below.

## What Aiden can and cannot touch

- **One app.** The helper is bound to the app you choose when the test starts. It reads that app's accessibility tree, presses its controls, and types into its fields. It never reads or acts on other apps.
- **That app's window only.** Screenshots capture the chosen app's window, even when other windows cover it, so other apps, notifications, and your desktop never appear in evidence.
- **Background first.** Clicks and typing use accessibility actions, which work without moving your pointer or bringing the app forward. When a control has no accessible action, Aiden brings the app forward and clicks only inside its window. Avoid using the computer during those moments.
- **Your real data.** The app runs with your account, files, and settings. Tests may change them, and stopping a test does not undo earlier actions. Sign in with a test account when the app has one. Aiden refuses password fields and obviously destructive buttons such as Delete, Pay, or Send.
- **Updates.** When a criterion needs the newest build, the agent may use the app's own update control. Aiden records the version before and after, keeps driving the app after it relaunches, and the report shows any change. Operating system prompts, such as an administrator password, are left to you.
- **Team publisher policy.** Team admins choose **Allowed app publishers** in the Teams dashboard under **Team settings**: macOS Team IDs or Windows publisher names. When you are signed in to Teams, Aiden refuses to test an app signed by anyone else, before taking any action. If Aiden cannot read your teams' lists, it does not start the test. With no list, or without Teams, any installed app can be tested.

## Permissions

On macOS, Aiden needs two permissions in **System Settings > Privacy & Security**:

- **Accessibility**, to read and press controls in the app you choose.
- **Screen Recording**, to capture that app's window.

Run `pnpm cli desktop-ready` to see what is missing; it also asks macOS to show the permission prompts. During development the permission belongs to the program that launched Aiden, such as your terminal. Windows needs no extra permission.

## Run a test

List installed macOS apps with `pnpm cli desktop-apps`. Then use `pnpm cli verify-desktop --config desktop-test.json [--out evidence-directory]`:

```json
{
  "name": "Notes beta",
  "target": { "appPath": "/Applications/Notes.app" },
  "criteria": ["Create a note, reopen it, and confirm its text is retained."],
  "runtime": { "provider": "codex", "auth": "subscription" },
  "allowInteractions": true,
  "stepLimit": 25
}
```

On Windows, `appPath` is the program's `.exe`, such as `C:\\Program Files\\Notes\\Notes.exe`. If the app is not running, Aiden opens it. When the test ends, the app stays open.

The evidence report lists each step's window screenshot and accessibility observation, the app's identity, version, and signer as read from the installed app, any version change during the test, and the provider and authentication used.

## Validation status

Automated tests use a scripted helper and scripted provider output to exercise element and secret handling, the team publisher policy, update detection, evidence review, and reporting. They are not evidence of a real app run. Validate on your own apps before relying on results.
