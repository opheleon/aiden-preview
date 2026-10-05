# Changelog

## Unreleased

## 1.2.1

- Make the community invitation easy to find with a “Join our Slack” sidebar link.

- Stop code checks from re-asking an open decision in different words: checks now receive open decisions and cite them instead. When an answer settles a reworded duplicate, the scope rewrite closes it and records why, while blockers the rewrite merely omits stay open.

- Distinguish a requirement’s own blocking decision from a prerequisite’s. Dependent features show Waiting on prerequisites, keep their agreed acceptance criteria, have their existing code assessed, and name the prerequisite decision they wait on instead of repeating its assumption.

- Show feature IDs in the delivery plan so they match tickets, and name removed features with a link to their preserved issue. Show the current focus when only later steps wait on decisions.

- Choose a decision option, then confirm with Answer, so a stray click cannot rewrite scope. Explain what is missing before a new project can start, hide outcome acceptance until a check has run, and name the selected provider in account-switching guidance.

- Keep the run stage tracker in step with progress, title stopped and failed runs by their outcome, and record whether you, a timeout, or closing Aiden stopped a run, ending its elapsed time at the stop.

- Let the sidebar project list use the full sidebar height, and name the macOS app menu Aiden.

## 1.2.0

- Hide new Jira and custom MCP setup while they are experimental. Preserve saved connections and project links, with clear Experimental labels.

- Prevent excessive CPU use when formatting untrusted page or model text containing long whitespace sequences.

- Record project outcome acceptance with a note, preserving automated evidence and decision history. Close projects to pause monitoring and ticket syncing; reopen them from Closed projects.

- Align the introduction and user docs with Aiden’s marketing: your first autonomous project manager. Organize onboarding around setting the intent, making the calls, and accepting the outcome.

- Introduce a five-step first-use guide for setup, projects, maintenance, and delivery evidence. Remember explicit confirmation per local profile, keep dismissal temporary, recover preference failures visibly, and provide replayable Help with offline user documentation.
- Treat Linear prerequisite URL autolinks and rich references to verified project tickets as equivalent during reconciliation, while preserving conflicts for changed link text, destinations, and unknown references.

- Add project-specific branch monitoring with live remote choices, current-branch defaults, an overview label, and fresh assessments after branch changes. Local checkout changes do not move a saved selection.

- Monitor remote default-branch commits and assess freshly fetched remote snapshots without changing the checkout. Keep local-only and legacy evidence from establishing delivery completion; surface Merge unverified when remote evidence is unavailable.

- Surface delivery deviations above Overview progress and on collapsed delivery items. Compare completed tracker tickets with fresh requirement evidence, distinguish pending checks from unverified completion, and expose evidence, downstream impact, and direct review links.

- Normalize Linear project identifiers to UUIDs and safely recover existing linked destinations so ticket read-back and status monitoring work. A first observed completed or canceled ticket now requests an evaluation even when an earlier sync failed.

- Fix Linear project discovery exceeding its 50-result limit, validate numeric tool bounds locally, and identify failed tracker operations with safe, actionable errors.
- Save OAuth credentials in the OS store by default, honor explicit session-only authentication, preserve saved connections across restart, and recover lost MCP sessions during read-only discovery. Verify token refresh, rotated refresh-token persistence, revoked consent, and restart recovery with synthetic OAuth fixtures.

- Reuse existing tracker presets on repeated connection attempts, separate legacy read-only Linear entries from publishing, show connection readiness, and offer inline reconnect with automatic browser sign-in status refresh.

- Load Linear teams from the connected account when the team dropdown opens. Create and verify a scope-named Linear project per Aiden project when publishing, preserve its identity on resync, and recover uncertain creates without duplicating projects.

- Link delivery tickets inside their requirements, with project-level connect, publish, and resync actions for trackers connected later. Keep shared vertical tickets, remove duplicated scope text, and show publication errors beside the plan.
- Add editable test plans to delivery features. New shared foundation plans require explicit verification, including consumer integration and failure checks; legacy plans remain readable and flag missing test plans.

- Show Blocked or Partly blocked on runs waiting for scope decisions, with the missing question and an inline answer control. Keep investigation completion separate from delivery readiness.

- Name projects from their scoped outcome, with scope-based labels for existing projects. Refine project typography, card spacing, and delivery step summaries.

- Simplify project overviews with expandable delivery steps and estimates, readable text, and separate Overview, Scope, Activity, and optional Coding tabs. Keep decisions and incomplete-check warnings visible.

- Automatically publish ordered feature tickets to configured Linear/Jira MCP destinations, verify writes, reconcile scope, and monitor status while open. Persist recovery markers, preserve human edits, and queue evidence checks after tracker status changes.

- Block undefined behavior and dependent requirements until decisions are answered; preserve independent investigation and pause total sizing.
- Write local feature tickets with acceptance criteria, evidence, dependencies, and explicit blocked drafts.
- Move coding-agent dispatch behind a per-project beta opt-in, disabled by default and enforced in the worker.

- Add a project Refresh button that reconciles coding delivery and reloads saved evidence. Show the same PR status in the overview, delivery plan, activity, and copied update without treating agent completion as requirement verification.
- Dispatch external Claude Code jobs into isolated worktrees with saved session, model, effort, result, PR, and local-check reports. Reconcile completion and GitHub merge state without an embedded coding loop or automatic merge/deploy.
- Replace automatic localhost checks with opt-in post-merge beta verification, scheduled hourly or daily while Aiden is open and gated on deployed commit identity.
- Refresh newly started runs immediately and clear live run state when opening a new project.

- Add account-advertised model and effort selection during project creation and in Settings. Show the actual model and selected effort in run details, and preserve effort in sizing snapshots.
- Publish API recordings as each criterion finishes, preserve OpenAPI authentication metadata, and support secret-safe JWT negative-test fixtures.

- Add API verification with a separate configured base URL, opt-in test writes, credential handles, deterministic HTTP assertions, independent evidence review, and recorded results in Watch. Inconclusive checks offer manual confirmation; demonstrated failures remain failures. Add a real-model working/broken API evaluation.

- Recover scope corrections after a worker restart before another code or browser check. Preserve the decisions used by each generated baseline.
- Suggest only successful HTML pages during localhost discovery and confirm their project identity before selecting one, even when only one page answers.
- Add a repeatable live-model header-correction evaluation and deterministic regressions for scope propagation and unrelated API targets.

- Generate an ordered delivery plan during setup, grouping requirements into vertical features with validated hard dependencies and optional plan editing.
- Compose actions and verification gaps inside requirements. Keep project-wide work and human decisions visible above the plan.
- Show overall completion, current focus, agreed timing, evidence confidence, and changes since the previous code assessment. Code presence alone is labeled Built until its completion checks are satisfied.
- Automatically size remaining work after successful code checks for projects with a delivery plan. Preserve legacy projects and show unknown effort without inventing dates.

- Turn the desktop app into an automated project manager. Setting up is one screen: say what you are building (type, paste, or import a file) and choose the folder. Aiden writes the requirements without a review step and runs a check.
- Write edge cases for each requirement at scope and check them like requirements, acting as the right kind of user. Each requirement shows one standard status: Done, In progress, Not started, Failing, Blocked, Needs manual test, or Unverified; edge cases show Pass, Fail, or Unverified.
- Replace blocking clarification questions with decisions. Aiden records the question with the assumption it proceeds on and never waits; answering a decision makes it check again.
- Add the project page: Status, Action items, Risks, Requirements, Scope, and Activity, an action log with Why? on each step.
- Add action items owned by Dev or PM: decisions to make, fixes and builds (with a copyable prompt for a coding agent), and manual tests to mark done. Aiden rewrites the list from every check, so finished work leaves on its own, and a manual test comes back after the next check because new code needs testing again. Risks lists what Aiden could not verify.
- Suggest running web pages on localhost and ask which belongs to the project. `AIDEN_APP_PORTS` sets the ports to try.
- Check again when a commit lands and once each morning while Aiden is open, replacing local schedules. Run check now picks up a check that stopped early.
- Remove the requirements review step, Drafts, the clarification dialog, header buttons, the App URL panel, Check now, the Schedule settings tab, the visible Estimates section, and workflow history. Exports and Run check now move to one menu; the folder, app URL, and context connections move to Settings, Project.
- CLI: `calls --project ID` lists open decisions and `answer --project ID --call ID` answers one.
- Cover each repository's default branch automatically when the code selection leaves repositories out, so a project folder with many repositories no longer fails its check.
- Use an answer given while Aiden is working as soon as that work ends, instead of waiting for the next commit.
- Explain a failed or interrupted check or rewrite on the project page, with Run check again or Try again, and say in plain words which step failed and why.
- Ask fewer questions when writing the requirements: at most three, and none for choices a sensible default settles.
- Add the Why? conversation: Why? on any line of Activity opens a chat for that run. It answers first from the reason Aiden recorded when it acted, at no cost, and answers follow-up questions from the run's saved record using the project's own model and billing, without tools.
- Add Runs: every run with live status, elapsed time, and its current step; opening a run shows its stages, what it is doing now, the full step-by-step history as it happens, Stop, and the Why? conversation.
- Record every step a run takes (files read, searches, browser actions, stage starts) in its history and stream it live, described in plain words.
- Make checks faster: choose commits without a model turn (the checked-out commit, the default branch, and worktree branches), sync repositories at the same time, and check the app alongside the code instead of after it.
- Improve repository discovery: skip folders a repository ignores, such as old checkouts, and fold extra worktrees into their main checkout. When writing the requirements, Aiden picks the repositories the goal is about, and checks and the commit watcher use only those.
- Use the light Aiden mark as the app icon, including in the Dock during development.
- Lay the project page out as one column of cards with consistent spacing; requirement rows expand to show edge cases and evidence.

- Size remaining changes by touch points, testing difficulty, and risk; derive time ranges only from recent comparable tickets, with inspectable explanations. Remove manual time and velocity controls.
- Enlarge desktop estimate explanations, comparison details, and evidence text.

- Rename the sidebar community link to "Feedback & support" with a tooltip for bugs, feature suggestions, and help on Slack.
- Prototype browser verification: each project saves its own app URL from App URL on its overview (or `verify-url`). Refresh status then assesses the code and tests each approved requirement against the running web app in recorded Chromium sessions; Check now in the App URL panel (or `verify --project ID`) runs only the browser check. Each check writes a standalone HTML report with videos, outlined proof screenshots, and Pass, Fail, or Couldn't verify results.
- Show each requirement's code status and browser result separately (Implemented in code, Verified in browser, Fails in browser). Watch recording opens a pop-up with the requirement's video, proof screenshot, and steps.
- Legacy projects retain optional estimates; projects with a delivery plan now size remaining work automatically after code assessment.
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
