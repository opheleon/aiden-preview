# Behavioral regression evaluations

Run `pnpm eval:behavior claude 3` (or `codex 3`) after signing in to that provider's subscription. The optional second argument is the number of independent attempts, from 1 to 10; the default is three. `AIDEN_SMOKE_MODEL` selects an explicit model. The runner never switches to API-key billing. Runs consume the selected provider's normal quota and require loopback networking for local MCP tools.

## Header correction scenario

The scenario recreates a failure where a request to remove redundant header text became a requirement to remove a Projects panel. It seeds that mistaken interpretation as synthetic baseline data, then submits a correction through the same `answerAndLook` entry point as the desktop. Requirement rewriting, code assessment, summary, and sizing use real model inference. The repository contains a header with both a navigation button and a redundant label, plus a sidebar that should stay.

The runner checks that one stable requirement remains, that the report uses the newly committed scope, and that the still-present label is correctly reported as missing removal with inspected source evidence. A separate tool-free model turn evaluates whether the requirement targets just the label, preserves the panel and navigation button, and removes obsolete panel-removal checks from scope and remaining work. The judge sees the expected correction; the production agent never sees evaluator answers or scores. This semantic grade is useful but fallible, so it cannot override deterministic failures.

An unrelated local API returns a JSON authorization error. Discovery must leave the app URL unset, ask for the real app URL, and avoid browser verification against that endpoint. This is a workflow evaluation, not a desktop or browser end-to-end test. It does not demonstrate that Aiden can operate its own Electron interface, nor does it evaluate the first interpretation of an ambiguous brief.

## Evidence and limits

Each attempt gets a fresh temporary repository and Aiden store. The printed `evaluation.json` location retains every attempt's outcome, elapsed time, runtime/model identity when available, judge rationale, and the path to full production run artifacts. Auth/profile data is separate from scenario artifacts; do not publish provider directories. A failed attempt remains failed even when later attempts pass. Any failure makes the command exit nonzero. Each scenario has a five-minute deadline; the judge shares that deadline.

Start with this case when changing the scope or discovery workflow. Add distinct, reviewed scenarios for ambiguous target selection, correction during concurrent verification, and broken/fixed/regressed app behavior before treating this as a general quality gate. Several passing attempts provide regression evidence, not proof of overall reliability. Keep live runs opt-in; normal `pnpm check` is credential-free.

`tests/scope-correction.test.ts` separately covers idle and busy corrections plus recovery from persisted answers after a restart, including legacy baselines. Those tests use synthetic provider output and intercept the browser boundary to inspect the scope it receives. `tests/app-discovery.test.ts` covers API errors, successful JSON, redirects, and unconfirmed HTML pages. Previously saved app URLs remain supported; a URL that an older version selected incorrectly must be corrected in project settings.

## API verification scenario

Run `pnpm eval:api claude` or `pnpm eval:api codex` to exercise the production triage, HTTP tools, independent evidence reviewer, and recording flow with real inference and subscription auth. The disposable loopback API has a registration endpoint and a protected events endpoint. The working case must pass missing/invalid token rejection plus a successful authenticated control. The deliberately broken case returns events without authentication and must fail. A database password-hashing requirement must be routed to a person because HTTP cannot establish it. The evaluator supplies no expected verdict to the production prompts.

Artifacts are saved under `.aiden/evaluations/api-eval-*`, including `evaluation.json`, the full HTTP transcripts, HTML reports, screenshots, and videos. Provider profiles are private and must not be published. Each scenario has a five-minute limit and failures exit nonzero. This is live inference against a synthetic API, not evidence that the user's Calendar service works. Deterministic tests separately cover request boundaries, write permission, redaction, assertion failures, incomplete coverage, unavailable frontend fallback, and manual confirmation.
