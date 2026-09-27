# Contributing to Aiden

Aiden is preparing an open-source macOS beta. Read the [README](../README.md), [architecture](../docs/architecture.md), [security boundary](SECURITY.md), and [code of conduct](CODE_OF_CONDUCT.md) before changing trusted-process behavior.

## Set up

Use the Node version in `.node-version` and exact pnpm version in `package.json`. Run `pnpm install --frozen-lockfile`, then `pnpm dev`. Do not mix package managers or generate an npm lockfile. Package policy lives in `pnpm-workspace.yaml`; see [dependency security](../docs/dependency-security.md).

## Required checks

Run `pnpm check` before opening a PR and `pnpm test:desktop` for desktop changes. See the [README](../README.md#development) for individual commands. Tests use synthetic provider output; live checks require sign-in and spend quota. Never label fixture output as a live model result.

Desktop screenshots and traces belong in ignored `test-results/`. Only deliberately selected documentation images belong in `docs/screenshots/`; the README uses `report-fixture.png`. CI uploads failure evidence.

## Coding standards

- All handwritten executable source is TypeScript. Preload `.cts` compiles to Electron-compatible `.cjs`.
- Non-test code files contain at most 500 physical lines. Production functions contain at most 100 nonblank/non-comment lines; React components may contain 150 including JSX.
- Cyclomatic complexity is capped at 15 and nesting depth at 4. Extract coherent responsibilities rather than arbitrary numbered helpers.
- Document named production functions and methods, including private helpers. Document exported types and explicit public return contracts. Inline callbacks and test bodies need no JSDoc.
- Explain purpose, assumptions, effects, errors, and cancellation when relevant. TypeScript supplies type information; JSDoc should not repeat it.
- Use validated `unknown` for external input. Handle promises, exhaustively handle states, and clean up timers, processes, and listeners.
- Keep renderer code separate from privileged implementations; type-only contract imports are allowed.
- Suppressions must name the rule and explain the specific reason. Do not weaken a rule or exclude a production module to make a gate pass.

```ts
/**
 * Publish an accepted report only while its reviewed baseline is still current.
 * Rejects stale runs without replacing the previous accepted report.
 * Cancellation is checked before updating the current-report pointer.
 */
async function publishReport(report: Report, signal: AbortSignal): Promise<void> {
  // Implementation belongs in the trusted worker.
}
```

## Tests and compatibility

Add behavioral regression tests for reproducible bug fixes. Preserve stored project/report/checkpoint fixtures when refactoring. Test errors and recovery as well as success. No focused tests may be committed; explain intentional skips. Coverage includes unimported runtime files. Backend and renderer each require 80% lines/statements/functions and 75% branches; designated security and data-integrity modules require 90% and 85%, respectively. Test useful behavior rather than implementation details.

Keep worker methods and existing persisted schemas compatible. Explain any deliberate contract evolution and migration in the PR. Add security boundary tests for new tools or privileged bridge operations.

## Pull requests

Open a focused issue for substantial proposals. Explain the problem, resulting behavior, compatibility implications, and validation in the PR. Keep refactors reviewable. Update documentation and the Unreleased changelog for user-visible changes. Contributions are submitted under the project's Apache-2.0 license; preserve third-party attribution.

Never commit credentials, private source snapshots, customer context, provider profiles, or local application data. Workflow prompts define role/success criteria, context priority, positive proceed rules, XML sections, and concrete edge cases. Source text remains evidence rather than authority.

Stylelint enforces standard CSS syntax and disallows ID selectors. Descending specificity is intentionally not checked: independent feature selectors share terminal elements, and reordering them solely to satisfy that heuristic could change the existing cascade. Brand color tokens retain up to eight decimal places. Keep feature imports in cascade order.
