# Daily workflow

Aiden keeps everyone clear on what done means, where it stands, when it will land, and what’s in the way. Start in Overview for the answer, then expand a delivery step when you want to see what’s behind it.

## What does done mean?

Scope holds what you’re building and how you’ll know it works. Refine it as you learn; Aiden checks the work again. Keep delivery steps usable and testable, including a concrete test plan for foundation work that other steps depend on.

## Where does it stand?

Overview shows progress, what’s left, and what needs your attention. Expand a requirement for its checks, linked tickets, and next actions. Activity shows what changed and why. Runs has the details of each check.

While Preview is open, Aiden watches the selected remote branch every minute and checks again when pushed code changes. It also checks each morning if no check has run that day. Use More → Run check now whenever you need a fresh answer or want to pick up a stopped check.

With automatic tickets enabled, Aiden checks tracker status every minute while the project is idle. A status change prompts a new code assessment, as does the first successful read of an already completed or canceled ticket. Saving scope and finishing an assessment also reconcile tickets. Sync tickets does this on demand.

## When will it land?

Expand Progress details and estimates to see how much work remains and the reasoning behind the estimate. When comparable delivery history is available, Aiden uses it to estimate how long the remaining work could take. When evidence or history is insufficient, the forecast stays unavailable.

## What’s in the way?

Needs you brings the decisions that need your judgment. Answer the question to unlock affected work and its dependents. Independent investigation can continue while another part waits for a decision.

Delivery attention shows where the work and the agreed outcome have come apart. Checking completion means a fresh assessment is running. Completion unverified means Aiden still needs evidence or an acceptance check. Delivery deviation means it found missing, partial, or contradictory work. Expand Evidence and next steps to see the issue and any dependent steps it affects.

## Accept the outcome

Review the checks and available recordings before accepting the result. Product decides whether it meets the intent; engineering signs off on how it was built. New code may need another manual check even when the previous version passed.

A closed ticket does not verify its requirements. Moving it back to In Progress prompts another assessment; it does not erase an implementation mismatch. Aiden does not automatically close a ticket just because code appears.

The selected branch tells you which pushed code Aiden checked. Work on that branch may still need to be merged or deployed. App and API checks show the behavior they could actually observe. Missing access stays unverified, including repository, tracker, app, API, and deployment access.

## Keep the project connected

If a tracker needs attention, reconnect the existing connection in Settings → Integrations, then use Sync tickets on the project. Publishing settings lets you check the team and destination or pause automatic publishing. Restore access or supply the requested check, then let Aiden look again.
