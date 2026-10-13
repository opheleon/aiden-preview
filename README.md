# Aiden

**Your first autonomous project manager.**

Aiden Preview runs on your Mac with your Claude or ChatGPT subscription. Tell it what you're building, point it at your code, and it turns your intent into a delivery plan, checks progress, and brings you the decisions that need your attention.

You set the intent, make the calls, and accept the outcome.

**Preview · Apple Silicon macOS · Apache 2.0**

[Website](https://opheleon.ai) · [Download](https://github.com/opheleon/aiden-preview/releases) · [Getting started](docs/getting-started.md) · [Join our Slack](https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw)

![Aiden project overview using synthetic fixture data](docs/screenshots/report-fixture.png)

_Example shown with synthetic project and update data._

## What Aiden does

- **Defines done.** Turns a brief, notes, or a sentence into requirements and ordered delivery steps.
- **Follows the work.** Checks pushed code on your chosen branch and shows progress, gaps, and evidence.
- **Keeps decisions visible.** Surfaces blockers and questions in **Needs you**, with estimates when enough evidence is available.
- **Keeps tickets connected.** Optionally publishes the delivery plan to Linear and keeps it in sync while preserving human edits.
- **Records your review.** Accept an outcome with a note, or close a project to pause monitoring and reopen it later.

Aiden monitors projects while the app is open. Code assessments, app checks, and ticket status remain separate evidence; accepting an outcome preserves any failed or unverified checks. Experimental coding-agent dispatch is available by opt-in. Aiden does not merge or deploy code.

## Install

Download the Apple Silicon macOS DMG from [GitHub Releases](https://github.com/opheleon/aiden-preview/releases), open it, and drag Aiden into Applications. You'll need Git and a supported provider runtime. Windows, Linux, and Intel Macs are outside the current preview scope.

To verify a download, get `SHA256SUMS.txt` from the same release and run these commands, replacing the example DMG filename:

```sh
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
gh attestation verify Aiden-VERSION-arm64.dmg --repo opheleon/aiden-preview
```

Check, download, and restart from the update control at the bottom of the sidebar. Update preferences are under **Settings → Desktop app**. See the [release guide](docs/macos-release.md) for packaging and verification details.

## Quick start

1. Open **Settings → Model**, choose Claude or Codex, and follow the installation and sign-in steps. Codex needs its CLI installed separately; the Codex desktop app alone is not enough.
2. Create a project, describe what you're building, and select its code folder.
3. Choose **Hand it to Aiden**. It writes the requirements, plans delivery, and runs the first check.
4. Review **Overview**, answer questions in **Needs you**, and refine **Scope** as you learn. Connect Linear when you want shared tickets.

Your subscription limits or API charges apply; Aiden includes no model credits. Open **Help / Getting started** in the app or read the [getting-started guide](docs/getting-started.md) for more.

## Privacy

Projects and reports are stored locally in `~/.aiden` (or `AIDEN_HOME`). Selected context and code evidence are sent to your chosen model provider, so inference is not offline. Aiden does not collect usage metrics or upload diagnostics. See the [security policy](.github/SECURITY.md) and [trust boundaries](docs/architecture.md#trust-boundaries).

## Development

Use the Node version in [`.node-version`](.node-version) and the exact pnpm version in [`package.json`](package.json):

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm check` before contributing. A CLI is also included. See [contributing](.github/CONTRIBUTING.md), [architecture](docs/architecture.md), and [dependency security](docs/dependency-security.md) for development details.

## Support and contributing

Join the [Aiden Slack community](https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw) for setup help and feedback, or open a [GitHub issue](https://github.com/opheleon/aiden-preview/issues) for a bug or feature request.

For more detail, see the [daily workflow](docs/daily-workflow.md), [troubleshooting](docs/troubleshooting.md), [changelog](CHANGELOG.md), and [example reports](examples/reports/README.md).

## License

Copyright © 2026 Opheleon. Licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md).
