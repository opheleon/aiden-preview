# Changelog

## Unreleased

- Size remaining changes by touch points, testing difficulty, and risk; derive time ranges only from recent comparable tickets, with inspectable explanations. Remove manual time and velocity controls.
- Enlarge desktop estimate explanations, comparison details, and evidence text.

- Rename the sidebar community link to "Feedback & support" with a tooltip for bugs, feature suggestions, and help on Slack.
- Prototype browser verification: each project saves its own app URL from App URL on its overview (or `verify-url`). Refresh status then assesses the code and tests each approved requirement against the running web app in recorded Chromium sessions; Check now in the App URL panel (or `verify --project ID`) runs only the browser check. Each check writes a standalone HTML report with videos, outlined proof screenshots, and Pass, Fail, or Couldn't verify results.
- Show each requirement's code status and browser result separately (Implemented in code, Verified in browser, Fails in browser). Watch recording opens a pop-up with the requirement's video, proof screenshot, and steps.
- Move estimates into a collapsed, optional Estimates section. Estimates no longer start automatically after an assessment.
- Keep the app usable while a run is in progress: other projects, run history, and the current report stay available, and questions from another project's run name that project.

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
