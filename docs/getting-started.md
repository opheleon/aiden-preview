# Getting started

Meet Aiden: your first autonomous project manager. Aiden keeps everyone clear on what done means, where it stands, when it will land, and what’s in the way.

You set the intent, make the calls, and accept the outcome. Aiden Preview is your own AI project manager, on your Mac, with your Claude or ChatGPT subscription.

## Bring your own subscription

Choose Claude or Codex for ChatGPT on the start screen; it shows whether that model is connected, and **Connect** opens the sign-in steps. For Claude, install Claude Code, select **Sign in with Claude**, finish in the browser window it opens, and Aiden detects the connection; a paid Claude plan is needed. For Codex, install the Codex CLI and select **Sign in with Codex**. The same controls are in Settings → Model. Cursor is not supported in this Preview. Choose the model and effort for your project. Keep your selected subscription or API-key billing mode; provider limits and charges may apply. There is no separate Aiden sign-in.

Linear is optional. Connect it in Settings → Integrations whenever you want Aiden to publish your project’s tickets there. One connection can serve several projects. Jira and custom MCP are experimental and hidden for new setup while live end-to-end testing is incomplete. Existing connections remain available under Experimental connections.

## Set the intent

Start from a customer call, a brief, a sentence, or a Notion page link. Select the plus button beside Projects, tell Aiden what you’re building or paste the link, and select Hand it to Aiden. With Notion connected and its read tools approved in Settings → Integrations, Aiden reads the linked page, and the pages it relies on, when it writes the requirements. You connect your code in the setup chat that follows.

The project opens on its Chat tab, with the setup checklist at the top. The Guide plays back the requirements Aiden understood and takes your corrections. Next it asks you to connect your code folders, one or more, so it can estimate the work; without code it suggests delivery slices but gives no estimate. Then it asks how to check the work: a web app, an API, or checking it yourself, alongside code checks. See [Project Guide](guide.md).

Aiden writes down what done means in plain language, checks the work, and plans usable steps toward the outcome. The project takes its name from what you’re building. Each step should produce something you can test; a foundation step needs a plan for checking it before other work builds on it.

Choose the branch to follow in Settings → Project → Branch monitoring. It starts with your current branch’s remote upstream, or the same-named branch on origin or the sole remote. The choice belongs to this project and stays fixed when you switch your local checkout. Saving another branch starts a fresh check and preserves earlier history.

Aiden follows pushed code on that branch. Local edits stay on your computer. An unpublished or inaccessible branch remains unverified until Aiden can read it.

## Let Aiden write the tickets

If you use Linear, open Tickets on the project's delivery plan, then Connect tracker or Publishing settings. Choose your connection and team, enable automatic tickets, and select Create project and publish tickets.

Aiden creates a Linear project for this project and writes tickets from the delivery plan. Each requirement links to its delivery ticket(s); several requirements can belong to one usable step. Connecting later works too: Sync tickets publishes the existing plan and keeps the same issues up to date.

## Make the calls

Start in Overview for where the project stands, what’s left, and what’s in the way. Aiden brings questions to Needs you. Answer the question when a decision is yours; the answer goes into the project and unlocks the affected work. Independent investigation can continue while a decision is open.

Refine Scope as you learn: Change opens the selected requirement in chat for clarification and review. Activity shows what changed, with check details under All runs. Progress details and estimates explains the size of the remaining work and any available forecast. When there isn’t enough history to give a date, Aiden leaves the forecast unavailable.

## Accept the outcome

Review what Aiden checked and any available recordings: open a requirement to see its checks, evidence, and next actions. Delivery attention shows where the work differs from what you asked for; open the finding for the full story and what to do next. Accept outcome is in the project menu, and on the project itself once every requirement is done. Product decides whether the outcome is right; engineering signs off on how it was built.

Code on the selected branch, app or API checks, and ticket status each answer a different question. A closed ticket does not verify the result. A merge or deployment needs its own evidence, and unavailable checks remain unverified. Aiden does not close tickets just because code appears.

## Come back whenever you need

Help / Getting started reopens the introduction and these offline docs. Got it on the final step remembers that you’ve finished. Later, close, or Escape brings the introduction back next launch. Replaying it after completion keeps your original confirmation.

## Keep Aiden up to date

Use the update control at the bottom of the sidebar to check for a new version, download it, or restart when it is ready. Downloads show their progress there. Restart waits until active work is finished; updates never install just because you quit. Automatic-download and beta-channel preferences remain under Settings → Desktop app.
