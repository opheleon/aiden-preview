# Third-party notices

Aiden's original source is Apache-2.0. Dependencies, fonts, provider binaries, and service access retain their own terms. Exact dependency versions and integrity hashes are recorded in `pnpm-lock.yaml`.

| Component                                                                               | License / terms                                                                           |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| React, React DOM, Electron, electron-updater, MCP TypeScript SDK, Zod, @napi-rs/keyring | MIT; retain the installed copyright and license notices                                   |
| Lucide React, zod-to-json-schema                                                        | ISC; retain the installed notices                                                         |
| Instrument Sans, Instrument Serif, JetBrains Mono                                       | SIL Open Font License 1.1; retain the font licenses and reserved-name restrictions        |
| Claude Agent SDK and bundled Claude executable                                          | Anthropic commercial terms; preserve the unmodified binary and applicable notices         |
| Chromium and other components bundled with Electron                                     | Retain Electron's LICENSE and LICENSES.chromium.html from the actual runtime distribution |
| Playwright and its downloaded Chromium build (browser verification prototype)           | Apache-2.0 for Playwright; retain the browser build's bundled license notices             |

The installed Claude Agent SDK is governed by [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products). These describe running the unmodified Claude Code binary in third-party products with each user authenticating through Anthropic's own flow and paying for their own usage. Aiden uses the official SDK and the user's local Claude Code sign-in. Packaging must preserve the binary and its authentication methods; Aiden must not collect subscription tokens or resell usage.

Anthropic's [SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) still contains broader third-party login approval language, while its [Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) describes subscription usage through the SDK. Check these conditions against the shipped authentication flow during release review; SDK use alone is not a demonstrated distribution blocker.

This table is an overview, not a complete redistribution audit. Before distribution, inventory every installed production dependency and bundled native executable, preserve its license text and required notices, and record the exact artifact reviewed in [release evidence](docs/macos-release.md#beta-readiness). Include this document, Aiden's LICENSE and NOTICE, all applicable dependency notices, and Electron's Chromium notices in the distributed application. Do not infer a license for an asset with missing provenance.

Provider services and hosted MCP servers have separate terms. Aiden's source license grants no right to use Codex, Claude, Linear, another provider's account, or another organization's source code.
