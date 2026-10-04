# First-use guide: implementation and acceptance

## Delivery slices

This was planned in Aiden itself, then published through its Linear connection as the [Aiden first-use guide and docs project](https://linear.app/opheleon/project/aiden-first-use-guide-and-docs-cc79d995b743).

1. [OPH-211](https://linear.app/opheleon/issue/OPH-211/deliver-the-reliable-first-launch-guide-shell): durable explicit confirmation, first-launch modal, accessible navigation, and failure recovery. Commit a316740.
2. [OPH-212](https://linear.app/opheleon/issue/OPH-212/complete-guidance-delivery-interpretation-and-help-replay): full workflow guidance, Help replay, and offline user docs. Commit e689c7d.
3. [OPH-213](https://linear.app/opheleon/issue/OPH-213/publish-documentation-and-end-to-end-acceptance-evidence): native acceptance journeys, documentation, regression results, and human merge handoff.

Each slice provides a working user path or acceptance evidence for that path. Prerequisite project-management changes are isolated on codex/pm-workspace-foundation; the focused guide branch is codex/aiden-ftue. The prerequisite includes the existing browser-verification commit from PR #5 and targets main. Merge the prerequisite before the guide PR; PR #5 does not need a separate merge if the prerequisite is merged as-is. None of these branches proves a released or deployed version.

## Completion contract

The trusted main process reads preferences/first-use.json under AIDEN_HOME, normally ~/.aiden. A strict version-1 record contains schemaVersion and an ISO completedAt timestamp. It contains no provider identity, token, project data, or analytics. The two guide IPC handlers accept no renderer-supplied paths and authorize the main window frame.

Missing state means incomplete. Invalid JSON or schema produces a visible corrupt-state notice; inaccessible storage produces an unavailable-state notice. Only the explicit final Got it action writes completion, atomically with owner-only permissions. A failed write leaves the guide open with a retryable error. Concurrent confirmations are coalesced. Symlink path components are rejected. The IPC boundary test also rejects untrusted callers and arbitrary input before touching persistence.

Later, close, and Escape dismiss only the current window's guide. Confirmation survives reloads, restarts, provider changes, project switches, and ordinary app upgrades in the same data profile. Existing profiles without this record get the guide after upgrading. A new AIDEN_HOME gets a fresh guide. Help replay does not reset completion, and a completed replay preserves its timestamp even when Got it is selected again.

For normal replay, use Help / Getting started. For an intentional developer reset, quit, back up the profile, and remove only preferences/first-use.json in that profile. Never erase project data or credentials to reset the guide.

## User interface and content

A native modal dialog contains five steps with a short summary, two key points, expandable detail, progress, Back/Next, Later, and final Got it. Initial and step focus moves to the heading. Native modal containment keeps keyboard focus inside, Escape dismisses, and closing restores focus to the invoking control or Help. The layout scrolls within the viewport and keeps its footer reachable on a small window.

The three user docs are bundled from their repository Markdown sources and rendered as plain headings and paragraphs. They remain available offline, without executing embedded HTML or navigating away. Documentation cannot confirm completion. Guide navigation does not call provider installation, authentication, tracker publishing, or project mutations.

The content was checked against current settings and workflow code: Model and Project settings, live remote branch selection, optional Linear team/project publishing, Overview/Scope/Activity/Runs, decisions, checks, reconnect/resync, and delivery-attention states. It separates remote code, acceptance behavior, and tracker status. It promises no automatic merge, deployment verification, or ticket closure.

## Repeatable acceptance checks

Run with the repository's pinned Node and pnpm versions:

```sh
pnpm check
pnpm test:desktop
```

The desktop fixture uses a temporary AIDEN_HOME, synthetic providers, temporary repositories/remotes, and no default app-discovery ports. It strips API-key environment variables. No live provider sign-in, real project deletion, or real preference reset is part of these tests. Test providers are fixtures, not live model output.

| Requirement                                        | Evidence                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| First launch and existing profile without a marker | Renderer first-use tests and the native fresh-profile journey; storage tests preserve an unrelated project sentinel |
| Only explicit acknowledgement persists             | Storage test, Later/Escape journey, final-step confirmation, reload and restart                                     |
| Corrupt state and write failure remain recoverable | Storage tests plus native malformed-file and directory-in-place-of-file failure/retry journey                       |
| Keyboard and small-window usability                | Native heading focus, Tab/Shift+Tab containment, Escape, focus restoration, and 390 × 560 window screenshot         |
| Setup/project/maintenance/evidence guidance        | Five reviewed steps, three bundled docs, passive-navigation renderer assertions                                     |
| Completed and incomplete replay                    | Renderer tests, native completed replay, unchanged completion-file bytes, one dialog instance, accessible docs      |
| Regression of existing work                        | Full backend, renderer, desktop journeys, and desktop smoke commands above                                          |

Automated accessibility checks establish semantic roles, names, focus, keyboard behavior, and viewport fit. They do not represent a full VoiceOver audit. A signed packaged installer and a production deployment are outside this local source-build validation.

## Dogfooding findings

Creating the actual project through Aiden successfully generated nine requirements and three delivery tickets. Linear converted prerequisite URLs to Markdown autolinks on read-back, which initially appeared as content conflicts. The prerequisite fix normalizes only links whose label exactly equals their URL; changed labels or destinations still conflict. A subsequent live sync also exposed Linear converting prose issue IDs to rich issue mentions. Those normalize only when both the identifier and URL match a previously verified ticket in this project. Unknown references and changed destinations remain conflicts. Adapter and synthetic tracker tests cover formatting, pending-write recovery, and human-edit protection.

The initial project monitored an unpublished remote branch and correctly showed Branch unverified. A local implementation is not evidence that its monitored remote contains the change. Final delivery review should use the pushed FTUE branch, followed by main after human merge, and should retain outstanding acceptance requirements rather than closing tickets based on code alone.

## Recorded local results, 2026-10-04

The integrated source build passed pnpm check: 258 backend tests and 90 renderer tests, coverage thresholds, formatting, lint, source and documentation policy, dependency boundaries, typechecks, and production build. pnpm test:desktop passed all nine native journeys and the desktop smoke test. Its first-use screenshots and traces are generated under ignored test-results/first-use-* directories; the 390 × 560 screenshot was visually inspected.

An initial legacy tracker journey reloaded after choosing Later, so the guide correctly returned and prevented its next project click. Existing workflow fixtures now finish onboarding through the public controls before starting their scenarios. Dedicated first-use fixtures retain incomplete state to verify dismissal and next-launch behavior. The full desktop suite then passed, including tracker publication, reconnect, resync, and deviation behavior.

The tests use isolated synthetic profiles. The live Aiden project and its three Linear issues are separate dogfooding evidence, not substitutes for these repeatable tests. Human review and merge remain outstanding; local checks do not establish a signed release or deployment.

The verified development build was opened through native computer controls against the existing profile. All five steps, expandable detail, offline documentation, final acknowledgement controls, dismissal, and focus restoration were inspected. Later was used so the real user can still receive the introduction; successful durable confirmation was exercised only in disposable test profiles. The project branch was selected from the live remote dropdown as origin/codex/aiden-ftue and a fresh assessment was started.

After the rich-reference reconciliation fix, pnpm check passed again with 260 backend tests and 90 renderer tests. The affected native tracker journey was rerun and passed, including publishing, reconnect, resync, deviation detection, and human-edit protection. A live Sync tickets at 2026-10-04 19:37 UTC read back OPH-211, OPH-212, and OPH-213 as synced and In Review, with no false content conflicts. The remote assessment of commit 5b771c7 on origin/codex/aiden-ftue recognized eight requirements as implemented and REQ-9 as partial because its frozen evidence could not independently verify PR and CI metadata. The app correctly showed “8 built, awaiting verification,” rather than treating the tickets as completed.

Review artifacts are [prerequisite PR #6](https://github.com/opheleon/aiden-preview/pull/6), targeting main, and [FTUE PR #7](https://github.com/opheleon/aiden-preview/pull/7), targeting codex/pm-workspace-foundation. Both remain unmerged for human review. Merge #6 first, then retarget #7 to main if necessary. The native desktop and security jobs passed on the initial FTUE push; CI on any later push must be checked on that exact head before merge.
