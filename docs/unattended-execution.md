# Unattended Teams execution

Teams work has three separate signals. Device check-ins describe presence. Runner-observed output and tool boundaries describe execution activity. The coding agent's status reports describe its intent, questions, and claimed outcome. A status report does not renew the task lease or prove completion.

## Limits and authority

Each task claim starts a numbered attempt with a distinct identity, an absolute deadline, and a five-minute lease. The desktop renews the lease every 15 seconds and stops locally five seconds before its last acknowledged lease expires. The three-minute online indicator is independent of this lease.

Default limits are:

| Task                         | No execution activity | One active tool | Entire attempt |
| ---------------------------- | --------------------- | --------------- | -------------- |
| Coding build                 | 15 minutes            | 45 minutes      | 2 hours        |
| Requirements and other tasks | 10 minutes            | 30 minutes      | 45 minutes     |

Quiet tool execution uses its tool budget rather than the idle budget. Repeated output or status messages cannot extend the absolute deadline. The runtime also supervises external coding independently of the desktop polling loop. Solo coding defaults to the same coding limits.

The server accepts an `EXECUTION_LIMITS` JSON object keyed by task kind. For example, `{"build":{"idleMs":900000,"toolMs":2700000,"absoluteMs":7200000}}`. All values must be finite positive integers between one second and one day. Changes affect new attempts; active attempts keep their recorded limits.

Task heartbeats, status reports, completion, and publication authorization carry the attempt identity. An old worker is rejected even when a newer attempt runs on the same physical device. Three automatic attempts exhaust the retry budget. Expiration is recorded as interruption, not proof that a laptop shut down.

## Status MCP and questions

Before model work starts, the desktop verifies the signed-in user's authority for the task and opens an ephemeral authenticated loopback MCP gateway. Only `report_status` is exposed by this gateway. The gateway supplies the team task, device, and attempt binding; those fields and the rotating Auth0 credentials are not model-visible tool arguments.

The worker uses the existing Teams browser sign-in and refresh flow. Authorization and token requests carry the configured Teams resource identifier alongside Auth0's audience configuration. Its Auth0 access token authorizes server status calls and is refreshed once on an unauthorized response. The coding process receives only the temporary loopback credential through runtime configuration, outside the prompt. Closing the attempt closes the gateway.

The Teams API also exposes a stateless status MCP transport at `/api/v1/mcp`. It verifies Auth0 tokens, advertises the Teams API resource and authorization server through protected-resource metadata, and requires trusted-launch headers `x-aiden-task-id`, `x-aiden-device-id`, and `x-aiden-attempt-id`. This is for Aiden launches; it is not a general task-management MCP or a manually connected agent workflow.

Use `progress` for meaningful updates, `question` for unresolved review questions while independent work continues, `blocked` when no authorized work can continue, and `reported_complete` for an outcome claim. Explicit questions become assigned human tasks, defaulting to the team owner when the requested person is unknown. Resolved assumptions stay in the PR. A genuine blocker releases active execution; the answer is passed into the subsequent handoff.

Prompts permit normal coding and testing tools and instruct agents to resolve reversible ambiguity. Interactive question and plan tools are disabled in unattended coding. Required permission prompts are denied with instructions to report the approval needed, rather than waiting indefinitely or bypassing approval.

## Recovery and publication

The server reconciles expired local attempts every minute through `/api/v1/cron/reconcile`, independently of device polling. The Vercel deployment must support minute-level cron. The long-running Node entry point also runs reconciliation every minute. Cron requests require the existing cron secret.

Before publishing, the runner durably records each repository, branch, base branch, committed SHA, checks, and summary. It rechecks attempt authority before pushes and PR creation. Publication finds and validates an existing PR before creating one, and recovers a lost creation acknowledgement by looking up that same branch.

A replacement attempt with a publication checkpoint performs publication reconciliation instead of running the coding model again. It verifies the recorded commit, reuses existing PRs, and publishes an already-pushed branch when necessary. If unpublished work exists only on the previous machine, it creates an assigned recovery question. Local worktrees remain intact; they are not assumed to be available on another computer.

Completion receipts are saved under the local data root's `team-completions/` directory before acknowledgement. A temporary reporting outage leaves the receipt pending, and the next poll retries it without rerunning coding or calling the failure endpoint. A superseded receipt remains on disk as evidence but cannot update a newer attempt. Server completion is idempotent, including follow-up creation and cost learning.

Cloud execution authority does not come from a desktop lease. Reconciliation ignores attempts explicitly marked as cloud work. Teams currently launches local coding only; this change does not add a cloud provider integration or infer cloud failure from a missing desktop.

## Rollout and verification

Deploy the execution migration and updated server and desktop together. The migration retires legacy leases that lack an attempt identity. Work requests now require `executionProtocol: 1`, so older clients cannot acquire tasks they cannot fence correctly. An older client must update before it resumes Teams work.

Credential-free regression tests cover lease expiry, exhausted attempts, stale same-device workers, cloud isolation, report versus activity timestamps, OAuth rejection, MCP binding, duplicate blockers, lost completion acknowledgement, runtime cancellation, long tools, and publication recovery. These tests use synthetic provider results and do not claim to be live model runs.
