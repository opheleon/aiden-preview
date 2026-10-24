# Changelog

## Unreleased

- Fix sizing failing with "could not size the remaining work" when the latest check found some requirements missing and others partly built. The remaining-work estimator now sees only the partly built requirements, and a rejected answer is told exactly which requirement IDs were missing or unexpected. Rejected answers are saved in the run folder for diagnosis.

- Add a [Windows setup guide](docs/windows-setup.md) written for first-time users: install the unsigned x64 installer, connect a ChatGPT or Claude subscription from PowerShell, and sign in to GitHub. Link it from the README, getting started, and troubleshooting.

## 1.2.5

- Make Chat the first project tab and the one each project opens on, replacing the chat overlay. Sidebar and Settings entries return to it, and drafts survive tab and page changes.

- Save each finished check's results into the chat where it happened, so they stay in scrollback after later checks or scope changes. Add View results in chat to the Latest check card.

- Show whether Claude or Codex is connected on the start screen and block Hand it to Aiden until it is, with a Connect button. Add Sign in with Claude, which opens Claude Code's own sign-in and rechecks the connection automatically, plus a Claude Code installation link.

- Keep the start screen to the heading and the box: what is still missing shows as a tooltip on Hand it to Aiden, and a model that is not connected offers Connect beside the provider.

- Aiden finds your code on GitHub in the setup chat. It lists the GitHub organizations you belong to, asks which one the project is under and which repositories matter, and uses all active ones (up to 30) if none do. Repositories named in the goal, a linked Notion page, or the chat connect right away with no questions. Each project gets a fresh read-only copy in its own folder (pushing disabled, hooks never run), using your Git or GitHub CLI sign-in for private repositories. Local project folders are no longer supported.

- Sizing now explores the code: estimates read the latest code check's snapshots with file listing, search, and reads, so touch points, existing patterns, and test coverage come from the code.

- Paste a Notion page link, including `app.notion.com` links, on the start screen and Aiden reads it, and the pages it relies on, when it writes the requirements. A link-only goal shows as New project until the requirements name it. Import a file and the start screen's folder button are removed.

- Reorder setup: agree the requirements, connect the code, then choose checks, which you can do while Aiden copies and reads the code. Without code, Aiden suggests its best-guess slices but gives no estimate, and no longer sizes the work from the requirements alone. Ask Aiden to re-estimate once code is connected.

- Keep setup to one compact line at the top of the chat, with every step and its explanation under Show steps. The ticket tracker is now the optional last setup step, offered in the chat once the required steps are done.

- Show delivery step outcomes, how Aiden knows each requirement's status, and delivery finding summaries inline instead of behind info icons and hover text.

- Show each project on one line in the sidebar, fading long names at the edge, with a … menu that holds every project action: Project settings, exports, Accept outcome, Reopen, and Close project. The header menu is gone, and long lists show five projects until Show more. Make the sidebar footer compact and remove Ask Aiden about this project now that Chat is a tab.

- Make the closing note optional when closing a project; acceptance still asks what you reviewed.

- Show remaining effort when the code check finds requirements entirely missing; those reuse their full size, and the second estimator pass runs only for partly built requirements.

- Fix stretched checkboxes in settings lists, keep the tool review's save button in reach, and give Connect Linear and Connect Notion the same size.

- Refresh the README, getting-started guide, Guide and daily-workflow docs, troubleshooting, and the first-run introduction for chat-first setup, GitHub code, and Notion pages.

- Lead chat answers with the direct answer and add numbered next steps naming the exact control when a question asks how to do something.

- Connect Notion in Settings → Integrations so Aiden can read the pages you link. Connecting approves only Notion's fetch and search tools; older connections get a one-click Allow reading Notion pages on the start screen. Notion is never offered as a ticket destination.

## 1.2.4

- Show concise folder and repository names on Windows throughout setup, testing settings, and project summaries.

- Require packaged desktop journeys on hosted Windows, Linux, and macOS runners, with installed Windows and extracted Linux AppImage coverage and screenshots/traces saved for every run.

- Wait for worker cleanup when closing the desktop app so interrupted checks keep their cancellation state across restart.

- Resolve bundled workflow files correctly on Windows so the installed app can write requirements and run checks.

- Include the verification browser and video encoder in macOS and Windows packages, so private sign-in and app checks work without a separate browser installation. Test packaged login with an unavailable external browser cache.

- Preserve cancellation status when a device check finishes during a concurrent status read.

- Keep requested web/API setup fields visible after settings load, including in smaller chat windows. Install the login-test browser in desktop CI and explicitly normalize public credential-presence flags used in access fingerprints.

- Show explicit setup status and a close button in project chat. Keep confirmed requirements confirmed when a code connection only refreshes the overview; genuine scope changes still require review.

- Confirm local-code and manual-check setup directly. Show access checks only for app/API/device targets, and update the actions automatically when selections change.

- Keep generic run introductions out of chat progress and move branch controls into Project settings under Testing settings, alongside app and API access.

- Keep chat progress compact with an animated status, adjacent Stop control, and one current activity line instead of repeated logs and internal stage labels.

- Show Aiden's introduction before clarification choices become available, preserving pending selections while a reply is being prepared.

- Keep completed check results and follow-up questions visible together when reopening chat through Show progress.

- Restore visible project progress, remaining effort, timing, and the delivery plan on Overview. Keep supporting evidence expandable, and show app-only verification progress with an explicit explanation when code-based estimates are unavailable.

- Reuse configured web test credentials through private sign-in during checks, including after sign-out. Keep credential entry unrecorded and outside model tools, and distinguish an unavailable account from a failed login or an unsupported form-state check.

- Simplify project navigation into Overview, Scope, and Activity. Open connection edits and requirement changes in the existing project chat, return to the previous page with Back, and run code plus configured app/API checks from one action. Keep advanced settings accessible and detailed delivery evidence folded away.

- Simplify project setup into four clearly marked steps with hover and keyboard-focus tooltips, a visible next action, and separate optional extras. Explanations leave the chat layout, drafts, and setup inputs in place.

- Keep live check updates, results, and expandable recordings inside the project chat instead of navigating away to Runs or a separate report.

- Select setup answers inline and submit them together without filling the message box. Support multiple selections for questions with compatible choices.

- Keep clarification conversational with one composer, inline answer choices, and animated response feedback.

- Resolve blocking scope questions directly in setup chat before confirming requirements. Incorporate answers before review, and prevent fully blocked app checks from reporting an empty success.

- Detect web sign-in from the page and a reusable session automatically, removing the required confirmation-text field from setup.

- Make the setup chat Thinking indicator visibly shimmer while a reply is pending, with a still label for reduced-motion preferences.

- Keep setup chat concise, show ongoing checks and result links inline, and show web/API-only results on the project overview. Include recorded browser transitions and non-secret API authentication metadata in independent evidence review.

- Fix setup chat failing with an invalid Codex transport configuration when tool connections are disabled.

- Store remembered project test credentials in OS secure storage, migrate legacy plaintext on use, and offer memory-only storage. Remove credentials with their login/API setup, default project closure to forgetting test credentials, and keep failed removals retryable without touching shared connections.

- Explain device permission requests beside connection controls so people know Aiden is accessing that connection's saved sign-in.

- Show a quiet Thinking indicator throughout setup replies and keep retry controls beside errors. Allow reasoning-only Codex turns without an MCP tool server. Cache integration credential reads in worker memory to avoid repeated OS permission requests.

- Hide iPhone setup while retaining its implementation; add API-key setup, private web sign-in checks, and a runnable SQLite-backed local authentication example.

- Setup uses a plain multi-select checklist and checks access to selected web, API, and iPhone targets before confirmation. Failed checks preserve saved settings.

- Open project setup and support as a reusable chat overlay with Back, visible setup TODOs, inline controls, and a persistent composer.

- Start a project from the intent alone. The project folder and Git are optional; a project without code skips the code check and is sized from its requirements, or checked through a saved web or API check.

- Add a per-project setup and support chat. It plays back the requirements for confirmation, asks how to check the work with inline folder, web, API, iPhone, and manual setup cards, and keeps a resumable setup checklist derived from saved project state. Afterwards it answers questions about runs and setup, makes stated setup changes, and points to Slack for help. One thread per project is condensed as it grows, and it always uses the project's own provider and billing mode.

- Build an unsigned Windows x64 installer alongside the macOS release, with its own update manifest, checksums, and provenance. Pass Windows system and profile variables to provider processes.

- Add customer-facing TestFlight instructions, including an external hosted-iPhone walkthrough and a clear distinction from Aiden’s connected-phone automation.

- Explain physical iPhone testing directly beside its controls, with USB and unlock instructions, one-time setup guidance, connection versus verification steps, and what happens during a run.

- Run automated desktop verification in hidden, non-activating windows while retaining screenshots and traces.

- Simplify iPhone verification with device/app pickers, detected builds, shared connection diagnostics and Apple signing preferences, and automatic lifecycle management for an installed local Appium server. Keep existing connections under Advanced settings.

- Add per-project verification configuration in the Guide and in Settings: browser, API, and installed iPhone targets, manual runs, and opt-in verification after successful project assessments.

- Add installed TestFlight build verification after a project’s repository assessment, with requirement-linked code and UI evidence, local Appium control, screenshot fallback, independent visual review, cancellation, and portable evidence.

## 1.2.3

- Make the overview readable at a glance: each requirement is one line with one status chip, and opening it shows everything Aiden knows in a pop-up, including its ticket, actions, verification gaps, and evidence. Delivery findings are one line each and open the affected requirement. A feature's outcome, rationale, and test plan sit behind an (i) button, and the chip explains how Aiden knows on hover.

- Move controls off the brief until they are needed: Adjust plan and Tickets open pop-ups, Accept outcome and Close project live in the project menu until there is a decision to show or every requirement is done, and the monitored branch is a hover on the last-checked line once it is configured.

- Publish a fixed-name Mac installer so the marketing download link can always follow the latest stable release.

- Track another team's roadmap from a pasted checklist: each open item becomes its own requirement, items the owners checked off count as done, unchecked items need merged work or an open pull request to show progress and count as remaining work rather than deviations, and their undefined scope never becomes a question for you.

- Credit work with receipts: code checks search commit history by date, path, subject, or changed text, look up pull requests on public GitHub repositories without credentials, and resolve pull requests and issues linked in your intent, including their live state. Checks also see your original text, so they flag premises that no longer hold, such as a release your intent still calls beta.

- Run app checks and Ask why with Codex again: reasoning-only steps no longer fail because they use no tools. App checks no longer pass a claim about every item from one example.

- Keep shallow clones usable for code checks, and name a partial clone with how to fix it instead of reporting a generic Git failure.

- Show work built in the code apart from verified work: the overall progress bar is green for requirements done and verified and blue for requirements built but not yet verified, with the built count beside the total. Requirements that can only be checked in code count as done.

- Name each repository in the project's monitoring line when a project has several, such as "rolldown on origin/main, vite on origin/main", and show one "not configured" before any branch is chosen.

## 1.2.2

- Put app update checks, downloads, progress, and explicit restart in the sidebar footer. Keep download and beta-channel preferences in Settings.

- Replace the project Refresh button with Run check now. Each check captures current code instead of resuming interrupted snapshots; coding delivery status updates automatically.

- Remove the duplicate Projects label from the middle of the header. The highlighted Projects button or Settings icon shows where you are.

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
