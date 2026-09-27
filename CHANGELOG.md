# Changelog

## Unreleased

- Prepare Apache-2.0 source distribution and contributor documentation.
- Introduce pnpm dependency policy with a 14-day release cooldown and reviewed install scripts.
- Convert preload and release tooling to TypeScript.
- Separate workflow, integration, and renderer responsibilities for testing and maintenance.
- Stop provider, authentication, cancellation, and disk failures from automatically retrying paid model turns; retain bounded correction attempts for invalid output.
- Validate Codex protocol messages and clean up pending requests on malformed output, timeout, and process exit.
- Persist evidence receipts before making them available for validation, preserving concurrent reads and rejecting failed writes.
- Bound estimation history pagination, reject corrupt source checkpoints, and preserve completeness limitations across resume.

This section describes development work, not a published or verified beta. See the [release gates](docs/macos-release.md#beta-readiness) for outstanding work.
