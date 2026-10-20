# Project Guide

Every project has one conversation with Aiden that helps you set up the project and keep it running. Chat is the first project tab, before Overview, Scope, and Activity, and every project opens on it. The setup checklist stays visible at the top, with the conversation and inline setup controls below.

Select the **Chat** tab, or **Ask Aiden about this project** in the sidebar from any page, including Settings. Switching tabs or pages keeps your unsent draft and conversation. If the project's model is not connected, a notice at the top of Chat links to **Settings → Model**.

A subdued **Thinking** indicator appears while the initial requirements and subsequent replies are pending. It stops when the reply or error arrives, respects reduced-motion preferences, and keeps retry controls beside the failed turn.

## Setup checklist

The top of the Guide shows the setup steps. Each step's state comes from what the project has saved, not from the conversation. You can close the app, change something in Settings, and come back; the Guide picks up at the first unfinished step.

1. **Define goal.** Aiden writes the requirements from what you sent.
2. **Review requirements.** The Guide plays them back, with any assumptions, and says what Aiden will do next. Select **Looks right**, or type a correction such as "REQ-3 should be admin only". Aiden rewrites the requirements and plays back what changed. A later change to the requirements opens this step again.
3. **Choose checks.** Pick one or more: connect the code (a folder with a Git repository), a web app, an API, or **I'll check it myself**. Use the checkbox list to select any combination and fill in its fields. **Check access** tests the selected web/API addresses and their configured private sign-in or API key. iPhone setup is currently hidden; its implementation is retained. **Confirm setup** becomes available only after all selected targets pass; editing a target requires a new check. A failed check preserves the previous settings. Successful access is separate from passing requirements.
4. **First check.** Run it now, or select **Later**. Checking by hand needs no automatic first check.
5. **Ticket tracker,** such as linking a ticket tracker. These never block setup.

When a step is unfinished on a project that has already been checked, the Overview tab also shows a **Finish setup** banner with **Go to Chat**.

While Aiden prepares a reply, a moving highlight sweeps across **Thinking**. It disappears when the reply arrives or an error occurs. The indicator stays still when reduced motion is enabled.

## What the Guide can do

- Answer questions from the project's saved record: where things stand, what needs you, when the last check ran and what it covered, why a requirement is marked as it is, and what each setting does.
- Make setup changes you state in the conversation, such as saving a web address you typed, switching to manual checking, starting a check, or applying a correction to the requirements. Each change appears as a line in the conversation, and you can revisit it from Project connections.
- Point you to Help / Getting started, or to the Slack community for anything it cannot fix.

The Guide never asks for passwords, tokens, or API keys. Test logins belong in the private verification settings. Folder choice and iPhone pairing always use their cards, because they need your computer.

The top of the chat shows setup on one line: its status, the current step, and its next action. **Show steps** opens every step with a plain explanation of what it involves, including the optional ticket tracker, which Aiden also offers in the chat once the required steps are done. Reading them never moves the chat or changes your answers. Once setup is complete, open Setup details to revisit the checklist and explanations.

Checks stay in the chat. While Aiden works, the conversation shows live updates and results as each app check finishes. Expand a result to read what happened and open its evidence inline, including recordings and screenshots. Code check conclusions, failures, and stopped checks also appear here. When a check finishes, its results are saved into the conversation where it happened, so they stay in scrollback after later checks or scope changes. **View results in chat** on the Overview's Latest check card brings the newest saved results into view.

Answers lead with the direct answer. When you ask how to do something, Aiden adds numbered next steps that name the exact tab or control to use.

## Project actions

Overview keeps the latest check, items needing attention, and a compact **Project connections** summary. **Manage**, **Edit web app**, and **Edit API** open the relevant controls in the existing conversation without sending a model request. **Check access & save** tests every selected target before changing saved settings; failed access leaves the previous configuration intact.

Scope keeps requirements browsable. **Change** attaches that requirement to the next message on the Chat tab; **Edit goal** and **Edit scope** open the same conversation for broader changes. Opening a control does not change the scope, and your draft is kept. Delivery plans, ticket controls, and code evidence remain available under **Delivery plan and code evidence**.

**Run check now** starts a check of current code and configured app/API surfaces and switches to Chat for live progress, Stop, and results. **Show progress** on other tabs returns to Chat without starting another check. Activity holds app results, expandable evidence, **All runs**, and project history. Advanced project settings retain repository, branch, tracker, schedule, and context controls.

## Privacy and billing

The Guide uses the project's selected provider and authentication mode, the same as every other Aiden run. It never switches from a subscription to API-key billing. It reads the project's public settings, requirements, and run summaries; verification credentials are never included. The conversation is saved in `AIDEN_HOME/projects/<project-id>/guide.json`, and older parts are condensed into a short summary as the thread grows. Setup facts the conversation adds, such as confirmed requirements and skipped steps, are saved in `setup.json` beside it.

Private verification forms offer **Remember test credentials on this device**. Remembered values use OS secure storage; memory-only values disappear when Aiden quits. If secure storage is unavailable, the setup event in the chat explicitly reports the session-only fallback. Removing a login or API setup clears its saved values. Closing a project defaults to forgetting its test credentials while retaining shared connections such as Linear. See [credential lifetime](verification-configuration.md#forget-credentials).

Blocking scope questions appear directly in chat, one at a time. Select answers beneath the question, then press Submit. Questions that allow several compatible answers say “Choose all that apply.” Selecting answers leaves the message box unchanged; you can still type a reply or ask a question there. Draft requirements cannot be confirmed while questions remain. Once answered, Aiden updates the requirements for review without automatically starting a check. Saved answers survive a failed update; use Update requirements to retry. Older projects with unresolved questions return to clarification even if their previous draft was confirmed.
