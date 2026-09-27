# Changelog

## 1.1.1

- Handle automatic update download failures without unhandled promise rejections, with packaged regression checks for background downloads, checksum rejection, retry, and opt-out.

- Find Homebrew and user-local Codex, Claude, and Node installations when Aiden is launched from Finder.
- Resolve bundled Claude to its unpacked executable so it can start inside a packaged app.
- Explain missing Codex CLI installation during setup and prevent unavailable sign-in attempts.
- Run complete analysis, export, restart, cancellation, and missing-provider recovery journeys against release packages.
- Publish releases by their created ID after verifying every asset; reject duplicate tags and incomplete uploads.

## 1.1.0

- Prepare Apache-2.0 source distribution and contributor documentation.
- Introduce pnpm dependency policy with a 14-day release cooldown and reviewed install scripts.
- Convert preload and release tooling to TypeScript.
- Separate workflow, integration, and renderer responsibilities for testing and maintenance.
- Stop provider, authentication, cancellation, and disk failures from automatically retrying paid model turns; retain bounded correction attempts for invalid output.
- Validate Codex protocol messages and clean up pending requests on malformed output, timeout, and process exit.
- Persist evidence receipts before making them available for validation, preserving concurrent reads and rejecting failed writes.
- Bound estimation history pagination, reject corrupt source checkpoints, and preserve completeness limitations across resume.

See the [release gates](docs/macos-release.md#beta-readiness) for verification evidence and outstanding beta-readiness work.
