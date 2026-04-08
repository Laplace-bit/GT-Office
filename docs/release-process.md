# Release Process

GT Office uses tag-driven GitHub Actions releases. The repository keeps the release surface intentionally small:

- `v*` tags trigger the release workflow
- build jobs run on matching macOS, Windows, and Linux runners
- release assets are uploaded to a single GitHub Release
- each tagged release reads its body from `docs/releases/<tag>.md`

## Preconditions

- The release commit has already been merged into `main`
- Version numbers are consistent across the workspace
- `CHANGELOG.md` and `docs/releases/<tag>.md` are updated for the new tag
- The repository can access `GITHUB_TOKEN` in GitHub Actions

## Build Matrix

The workflow reuses the existing entrypoint scripts:

- `npm run typecheck`
- `cargo check --workspace`
- `npm run build:tauri`

Platform-specific bundle targets:

- macOS: default build flow with `GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1`, which always publishes a `.dmg` plus a zipped `.app`; when signing and notarization are configured, the same flow can publish a proper distribution-ready DMG
- Windows: `npm run build:tauri -- --bundles nsis`
- Linux: `npm run build:tauri -- --bundles appimage,deb`

## Secrets and Signing

### GitHub

- `GITHUB_TOKEN` is required for creating or updating the GitHub Release

### macOS

For public distribution, configure Apple signing and notarization credentials in GitHub Secrets or Environment Secrets.

At minimum, the release runner needs whatever your signing flow requires for:

- Apple Developer ID signing
- notarization credentials
- any certificate material consumed by your chosen codesign tooling, for example `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`
- Apple account access for notarization, for example `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`

This repository's release workflow enables unsigned DMG generation on the macOS runner so the release always carries a `.dmg` asset. When signing secrets are configured, the same path can produce a proper distribution-ready DMG.

Without those secrets, the workflow still publishes both the macOS `.app` zip fallback and a DMG, but the DMG is only suitable for local testing or internal distribution.

### Windows

Windows signing is optional for the first release pass. If you later enable it, store the code-signing certificate and password in repository or environment secrets and keep the timestamping configuration in the workflow.

The current workflow does not enforce Windows signing.

Common secret names for a later signing pass are `WINDOWS_CERTIFICATE_PFX_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`, and a timestamp server URL.

### Linux

Linux packaging does not require special signing secrets for the base release flow.

## Tagging a Release

1. Update versioned files and the changelog.
2. Create or update the release body file, for example `docs/releases/v0.1.6.md`.
3. Commit the release changes.
4. Create the tag:

```bash
git tag -a v0.1.6 -m "GT Office v0.1.6"
```

5. Push the branch and tag:

```bash
git push origin main --follow-tags
```

The tag push starts the release workflow.

## Manual Re-Upload Flow

If the workflow succeeds but a release asset is missing or needs replacement:

1. Re-run the workflow after fixing the packaging issue, or
2. Download the job artifact from the failed or previous run, and
3. Upload the corrected file to the same GitHub Release

Use manual re-upload only when the tag and release notes are still correct.

## Retry Flow

If the workflow fails before release publication:

1. Fix the job-specific failure
2. Re-run the workflow on the same tag
3. Confirm that the release body and asset list still match the intended version

If the tag itself is wrong, delete the tag, correct the commit, and create a new version tag instead of forcing the wrong release forward.

## Known Limitations

- macOS unsigned builds now still publish a `.dmg`, but that is not the same as a notarized public release
- Windows release signing is not enforced by this workflow
- Linux package coverage depends on the bundle types emitted by Tauri on the runner
- The workflow assumes a single release tag per version and does not try to synthesize notes from commits automatically
