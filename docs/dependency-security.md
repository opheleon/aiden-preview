# Dependency security

Aiden uses pnpm 11.19.0, pinned in package metadata, and Node 22.23.2. Registry package resolution must wait 20,160 minutes (14 days), fail when publication dates are absent, and reject provenance downgrades. These controls reduce exposure; they do not prove code is harmless.

The workspace uses a hoisted layout to preserve existing Electron packaging. CI uses a frozen lockfile. Lockfile and dependency-policy changes require review. Direct Git/tarball dependencies need an explicit review; internal packages use `workspace:`. Never use an unpinned `dlx` or `npx` command in build/release automation.

## Reviewed trust exceptions

These exact-version exceptions were approved on 2026-09-26 after reviewing registry publication timestamps and comparing integrity hashes with the pre-migration npm lockfile:

| Package      | Publication | Reason                                                                                                                |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| semver@6.3.1 | 2023-07-10  | Existing Babel/build dependency; historical maintenance branch lacks provenance present in earlier-published releases |
| semver@5.7.2 | 2023-07-10  | Existing electron-builder transitive dependency through tiny-async-pool; same legacy provenance issue                 |

The registry SHA-512 hashes match the existing locked artifacts. This establishes continuity, not an independent security audit. Review the exceptions whenever their parent dependency changes and remove them when those versions leave the graph. No package-wide or age-based trust bypass is permitted.

## Install scripts and emergency updates

The following exact-version build scripts were reviewed and disabled:

| Package                            | Decision                                                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| esbuild@0.25.12 and esbuild@0.28.2 | Skip postinstall: pnpm installs the locked platform binary via optional dependencies. The script's fallback npm/tarball downloads would bypass workspace policy. Test the binary through the production build after each clean install. |
| electron-winstaller@5.4.0          | Skip its bundled 7-Zip copy step; Windows packaging is outside this release.                                                                                                                                                            |

Electron 44.3.0 has an explicit `install-electron` command rather than a lifecycle hook. CI downloads that pinned runtime without signing or provider credentials, then tests it. Review each dependency's actual script and platform-specific requirement before adding an exact-version allow or deny entry. New/unreviewed scripts fail installation. Never set `dangerouslyAllowAllBuilds`.

Routine update PRs wait 14 days and require review. An urgent security fix may receive a documented exact-version cooldown exception, with the advisory, validation, approver, and removal date recorded in the PR. Do not disable the global policy.

Install and test without production credentials. Signing and publishing secrets belong only to their dedicated release steps. Review lockfile scanner output to ensure it reports a nonempty dependency graph; unsupported lockfile formats must fail visibly.

## Migration resolution review

The migration retained the existing direct dependency versions wherever permitted by the 14-day policy. Six existing resolutions moved to mature releases: Claude Agent SDK 0.3.278 → 0.3.269, Electron 44.4.3 → 44.3.0, Prettier 3.9.8 → 3.9.6, Zod 4.6.5 → 4.6.2, @types/node 24.13.6 → 24.13.4, and tsx 4.23.15 → 4.23.13. These are policy-driven downgrades, not unrelated upgrades. New development dependencies implement the approved quality gates.

On 2026-09-26, a separate clean directory installed all ten workspaces using pnpm 11.19.0, the frozen lockfile, Node 22.23.2, and the reviewed script decisions. No provider API keys were supplied. The 75 then-existing deterministic backend tests passed under Node 22.23.2, and the production build passed. Later tests and refactors require their own final verification.

GitHub documents `pnpm-lock.yaml` support in its [dependency graph ecosystem matrix](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems). The generated lockfile uses format 9.0. Dependency review is configured; its actual nonempty graph must still be verified on the first source PR, because this repository currently contains only a license on its remote default branch.
