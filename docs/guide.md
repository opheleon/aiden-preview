# Project Guide

Every project has one conversation with Aiden that helps you set up the project and keep it running. New projects open this chat above the project. The setup checklist stays visible at the top, with the conversation and inline setup controls below.

Select **Ask Aiden** on the project or **Ask Aiden about this project** in the sidebar, including from Settings, Scope, or Activity. **Back** or **Escape** returns to the page you came from. Reopening chat keeps your unsent draft and conversation.

A subdued **Thinking** indicator appears while the initial requirements and subsequent replies are pending. It stops when the reply or error arrives, respects reduced-motion preferences, and keeps retry controls beside the failed turn.

## Setup checklist

The top of the Guide shows the setup steps. Each step's state comes from what the project has saved, not from the conversation. You can close the app, change something in Settings, and come back; the Guide picks up at the first unfinished step.

1. **Understand the goal.** Aiden writes the requirements from what you sent.
2. **Confirm the requirements.** The Guide plays them back, with any assumptions, and says what Aiden will do next. Select **Looks right**, or type a correction such as "REQ-3 should be admin only". Aiden rewrites the requirements and plays back what changed. A later change to the requirements opens this step again.
3. **Choose how to verify.** Pick one or more: connect the code (a folder with a Git repository), a web app, an API, or **I'll check it myself**. Use the checkbox list to select any combination and fill in its fields. **Check access** tests the selected web/API addresses and their configured private sign-in or API key. iPhone setup is currently hidden; its implementation is retained. **Confirm setup** becomes available only after all selected targets pass; editing a target requires a new check. A failed check preserves the previous settings. Successful access is separate from passing requirements.
4. **First check.** Run it now, or select **Later**. Checking by hand needs no automatic first check.
5. **Optional extras,** such as linking a ticket tracker. These never block setup.

When a step is unfinished on a project that has already been checked, the Overview tab shows a **Finish setup** banner instead of opening the Guide.

While Aiden prepares a reply, a moving highlight sweeps across **Thinking**. It disappears when the reply arrives or an error occurs. The indicator stays still when reduced motion is enabled.

## What the Guide can do

- Answer questions from the project's saved record: where things stand, what needs you, when the last check ran and what it covered, why a requirement is marked as it is, and what each setting does.
- Make setup changes you state in the conversation, such as saving a web address you typed, switching to manual checking, starting a check, or applying a correction to the requirements. Each change appears as a line in the conversation, and you can revisit it from Project connections.
- Point you to Help / Getting started, or to the Slack community for anything it cannot fix.

The Guide never asks for passwords, tokens, or API keys. Test logins belong in the private verification settings. Folder choice and iPhone pairing always use their cards, because they need your computer.

The setup checklist highlights the current step and its next action. Info icons beside Define goal, Review requirements, Choose checks, First check, and optional Extras show short tooltips on hover or keyboard focus, without moving the chat or changing your answers. Press Escape to dismiss a tooltip. Once setup is complete, open Setup details to revisit the checklist and explanations.

Checks stay in the chat. While Aiden works, the conversation shows live updates and results as each app check finishes. Expand a result to read what happened and open its evidence inline, including recordings and screenshots. Code check conclusions, failures, and stopped checks also appear here. Follow-up questions stay alongside the results, including when you reopen the chat through Show progress. Back returns to the page beneath the chat without losing your draft.

## Project actions

Overview keeps the latest check, items needing attention, and a compact **Project connections** summary. **Manage**, **Edit web app**, and **Edit API** open the relevant controls in the existing conversation without sending a model request. **Check access & save** tests every selected target before changing saved settings; failed access leaves the previous configuration intact.

Scope keeps requirements browsable. **Change** attaches that requirement to the next message; **Edit goal** and **Edit scope** open the same conversation for broader changes. Opening a control does not change the scope. **Back** restores the page and keyboard focus, retaining your draft. Delivery plans, ticket controls, and code evidence remain available under **Delivery plan and code evidence**.

**Run check now** starts a check of current code and configured app/API surfaces, with live progress, Stop, and results inside chat. **Show progress** reopens it without starting another check. Activity holds app results, expandable evidence, **All runs**, and project history. Advanced project settings retain repository, branch, tracker, schedule, and context controls.

## Privacy and billing

The Guide uses the project's selected provider and authentication mode, the same as every other Aiden run. It never switches from a subscription to API-key billing. It reads the project's public settings, requirements, and run summaries; verification credentials are never included. The conversation is saved in `AIDEN_HOME/projects/<project-id>/guide.json`, and older parts are condensed into a short summary as the thread grows. Setup facts the conversation adds, such as confirmed requirements and skipped steps, are saved in `setup.json` beside it.

Private verification forms offer **Remember test credentials on this device**. Remembered values use OS secure storage; memory-only values disappear when Aiden quits. If secure storage is unavailable, the setup event in the chat explicitly reports the session-only fallback. Removing a login or API setup clears its saved values. Closing a project defaults to forgetting its test credentials while retaining shared connections such as Linear. See [credential lifetime](verification-configuration.md#forget-credentials).

Blocking scope questions appear directly in chat, one at a time. Select answers beneath the question, then press Submit. Questions that allow several compatible answers say “Choose all that apply.” Selecting answers leaves the message box unchanged; you can still type a reply or ask a question there. Draft requirements cannot be confirmed while questions remain. Once answered, Aiden updates the requirements for review without automatically starting a check. Saved answers survive a failed update; use Update requirements to retry. Older projects with unresolved questions return to clarification even if their previous draft was confirmed.
