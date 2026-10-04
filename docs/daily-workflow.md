# Daily workflow

Start in Overview. Read the short summary, current focus, Needs you, and any Delivery attention. Expand a delivery step or requirement when you need evidence, linked tickets, risks, or next actions.

## Review and maintain the project

Use Scope to inspect or refine requirements. Scope edits start a new check. Use Activity to understand changes and Runs to inspect progress, failures, and blocked decisions. Answer a blocking question to unlock the affected work and its dependent steps. Independent investigation can continue while another part is blocked.

Use More → Run check now for an immediate assessment or to pick up a stopped check. Manual acceptance tests belong to you; new code can require another test even if a previous version passed. Review the test plan before accepting a foundation layer that other work depends on.

## Understand automatic monitoring

Monitoring requires the desktop app to remain open. Aiden checks the selected remote branch every minute without changing your checkout and reassesses when the remote commit changes. It also checks each morning if no check has run that day.

Tracker status is checked every minute while the app is open and the project is idle. A status change queues a fresh assessment; the first successful read of an already completed or canceled ticket also queues one. Saving scope and completing a code assessment reconcile tickets. Sync tickets performs an on-demand reconciliation.

## Read delivery evidence

Remote code progress, app or API acceptance evidence, and tracker status are separate signals. Local work is not proof that the monitored remote contains it. Code on a feature branch is not proof of a merge to main. Aiden does not automatically prove a deployment or GitHub Actions outcome.

A closed ticket does not prove its requirements work. Delivery attention shows Checking completion while a fresh assessment runs, Completion unverified when evidence is unavailable or acceptance is outstanding, and Delivery deviation for confirmed missing, partial, or contradictory work. Dependent delivery steps can be affected too. Expand Evidence and next steps to see the disconnect.

Moving a ticket back to In Progress prompts reconciliation and a fresh assessment. It removes the claim that the tracker says delivery is complete; it does not erase a real scope or behavior mismatch. Aiden does not automatically close a ticket just because code appears. Review evidence and decide when to change tracker status.

## Keep connections healthy

For an unavailable tracker, use Settings → Integrations to reconnect the existing connection. Return to the project and use Sync tickets. Publishing settings lets you pause or resume automatic publishing and verify the team and destination.

Missing repository, tracker, app, API, or deployment access stays unverified. Restore the required access or provide the requested acceptance evidence, then run another check. Do not treat a missing signal as a pass or a confirmed failure.
