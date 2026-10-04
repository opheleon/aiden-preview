# Troubleshooting

## The guide keeps returning

Finish the last step with Got it. Later, Escape, and the close button intentionally leave it incomplete. If confirmation cannot be saved, the guide stays open with a retry message. Restore write access to the local application data folder and retry Got it.

The preference belongs to this local AIDEN_HOME, normally ~/.aiden, not a provider account or individual project. Changing the data folder or reinstalling with a new profile gives a fresh introduction. Ordinary upgrades using the same profile keep completion. Existing installations without a completion preference receive the guide once after upgrading.

A missing preference is treated as first use. A malformed preference displays a recovery notice and can be repaired by confirming again. A read or write failure is never silently treated as completion. Projects, reports, provider authentication, and tracker credentials are separate from this preference.

## Replay or reset the guide

Use Help / Getting started for normal replay. Opening docs, moving between steps, closing, or choosing Later does not change completion. Selecting Got it after completion preserves the original completion timestamp.

For a deliberate developer reset, quit Aiden, back up the current data folder, and remove only preferences/first-use.json inside the intended AIDEN_HOME. Restart to see first use again. Do not remove the whole data folder: it also contains projects and reports. Keep this operation out of tests against your real profile; automated journeys use temporary isolated data folders.

## Aiden cannot start a check

Open Settings → Model and check the selected runtime, provider sign-in, model, and effort. Complete provider installation or authentication there. Keep the billing mode you chose; do not substitute an API key for subscription access merely to make a check run. Aiden has no separate account login to repair.

## Linear needs attention

Check the connection under Settings → Integrations and reconnect it if requested. Securely saved OAuth credentials can refresh; session-only authentication needs sign-in after quitting. Revoked consent or an expired refresh credential needs a new sign-in. Reuse the existing connection instead of adding duplicates.

Confirm the team, project destination, permissions, and publishing choice in Project settings. Use Sync tickets. A rejected operation may mean missing write access or a mismatched destination; reconnecting alone cannot fix those. A content conflict protects edits made in Linear: review the issue and the proposed plan rather than overwriting it blindly.

## Aiden needs more evidence

Check Settings → Project → Branch monitoring. Select an existing remote branch and make sure this computer can read it. Push the intended work before expecting remote code evidence. Missing GitHub credentials do not make browser checks proof of remote code delivery. Accessible app checks may still provide their own evidence.

If a closed ticket still shows a deviation, expand Evidence and next steps. Restore access, resolve the missing requirement, or run the outstanding acceptance check and reassess. A tracker status alone cannot clear a confirmed implementation mismatch.
