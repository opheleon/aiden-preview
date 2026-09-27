# macOS release and automatic updates

The installed application keeps the existing Opheleon identity:

- Product name: `Aiden`
- Bundle identifier: `ai.opheleon.desktop`
- Signing team: the same Developer ID Application certificate as earlier releases. macOS rejects an update signed by a different team.
- Update source: GitHub Releases for `opheleon/aiden-preview`

Project data, reports, and update preferences remain in `~/.aiden`. The renamed application’s replacement behavior and upgrade from the previous signed Opheleon package still require recorded verification; do not assume dragging Aiden.app removes Opheleon.app.

## How a release is built

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when a version tag is pushed:

| Tag             | Result                        | Who updates to it                           |
| --------------- | ----------------------------- | ------------------------------------------- |
| `v1.2.3`        | GitHub Release, marked latest | Every install                               |
| `v1.2.3-beta.1` | GitHub pre-release            | Beta builds and installs that opt into beta |

The build job checks that the tag matches `package.json`, requires the aggregate quality workflow, then packages, signs, and notarizes on a GitHub-hosted macOS runner. It verifies the signature and stapled notarization ticket, then tests that packaged application. The publish job, which runs no project code, writes `SHA256SUMS.txt`, creates a build provenance attestation for every file, and publishes the release with notes generated from merged pull requests. electron-updater reads `latest-mac.yml` and the ZIP from the release; the DMG is for new installs.

Running the workflow manually from the Actions tab is a dry run: an unsigned build uploaded as a workflow artifact, with nothing published.

### Repository secrets

| Secret                         | Value                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64 of the exported Developer ID Application certificate and key (`.p12`) |
| `MACOS_CERTIFICATE_PASSWORD`   | Password for that `.p12`                                                     |
| `APPLE_API_KEY_P8_BASE64`      | Base64 of an App Store Connect API key (`.p8`) with Developer access         |
| `APPLE_API_KEY_ID`             | That key's ID                                                                |
| `APPLE_API_ISSUER`             | The App Store Connect issuer ID                                              |

Create the Base64 values with `base64 -i file | pbcopy`. GitHub masks secrets in logs; the workflow never prints them.

### Cut a release

1. Set `version` in `package.json` (for example `1.2.0` or `1.2.0-beta.1`), merge it to `main`, and pull.
2. `git tag v1.2.0 && git push origin v1.2.0`
3. Watch the Release workflow. When it finishes, verify a download as described in the README.
4. From the previous signed release, check **Settings → Desktop app → Check for updates**.

A version must be higher than the installed version to be offered.

## Legacy update feed

Installs up to 1.1.0 read `https://d1adzf4ntt9phw.cloudfront.net/desktop/prod/mac/latest`. After each stable GitHub Release, and for as long as those installs matter, point that feed at the release:

```sh
pnpm release:legacy-feed -- v1.2.0 --dry-run
AIDEN_UPDATE_S3_URI=s3://YOUR-BUCKET/desktop/prod/mac/latest pnpm release:legacy-feed -- v1.2.0
```

The script downloads `latest-mac.yml` from the release and rewrites only its file names to the release's GitHub download URLs. It then uploads that manifest with no-cache headers using the active AWS CLI profile. No binaries are copied, so legacy installs download the same attested ZIP. After updating, they read GitHub Releases directly. Never run it for a beta tag.

## Build locally

```sh
pnpm package:mac
pnpm test:package:mac
```

Artifacts are written to `release/mac`. Local builds are for testing; published builds come only from the release workflow.

## Development checks

Unpackaged development builds report that automatic updates are disabled. To exercise the GitHub feed explicitly, build first and launch with `AIDEN_FORCE_DEV_UPDATES=1`; `dev-app-update.yml` supplies the feed. Do not use that flag during ordinary development.

## Repository controls

For `opheleon/aiden-preview`, require the aggregate `quality` check and resolved review conversations on `main`, including for administrators. Disable force pushes and branch deletion. Enable secret scanning, push protection, dependency alerts, and private vulnerability reporting. Enable Renovate for `.github/renovate.json`; configuration alone does not activate the app.

## Beta readiness

A configured check is not a passing result. Record the commit, artifact hash, environment, date, and evidence for each gate. Leave unavailable checks open; never replace live evidence with fixtures.

- [ ] Required quality checks pass on Linux and macOS with frozen pnpm installs.
- [ ] Deterministic Electron full journey, restart, export, and recovery pass.
- [ ] Coverage meets backend, renderer, and security-module floors.
- [ ] No unreviewed dependency script or registry/policy exception.
- [ ] License inventory and SDK/native-binary redistribution reviewed; required notices packaged.
- [ ] Provider/authentication capability matrix matches the released UI.
- [ ] Provider authentication follows applicable terms: unmodified Claude binary, provider-owned sign-in, individual credentials/billing, and no collected subscription tokens or resold usage.
- [ ] Fresh installation and first-run authentication verified with a clean profile.
- [ ] Focused independent security review completed and findings resolved.
- [ ] Confidential vulnerability and conduct reporting channels enabled and documented.
- [ ] Artifact signed with the existing team and notarized; Gatekeeper accepts it.
- [ ] Packaged app loads the worker, native keyring, and bundled provider binaries.
- [ ] Previous Opheleon release upgrades to Aiden without losing data or leaving a conflicting app.
- [ ] Stable/beta routing, interrupted download, and legacy-feed transition verified.
- [ ] Release remains draft until binaries, manifests, checksums, and provenance are present.
- [ ] Recovery instructions tested using a backup of application data.

External account access, signing/notarization credentials, an older installed package, and an independent reviewer are required for their respective checks. No public beta readiness is claimed until the checklist is complete.

Before public beta, finish startup/renderer recovery, historical saved-data compatibility fixtures, and consistent capability labels. Review the shipped authentication flow against the conditions in [third-party notices](../THIRD_PARTY_NOTICES.md). Validate the package through fresh authentication, offline startup, interrupted analysis, and relaunch. Activate Renovate and verify dependency review receives a nonempty pnpm dependency graph on the first PR.

The beta scope is Apple Silicon macOS. Windows/Linux installers, Intel macOS, hosted services, and VM isolation are later work. Track ongoing implementation in issues and user-facing changes in [CHANGELOG.md](../CHANGELOG.md).
