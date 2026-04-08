#!/usr/bin/env bash

# Usage:
#   scripts/release/build-and-upload-linux.sh v0.1.6 Laplace-bit/GT-Office
#
# Positional parameters:
#   $1 TAG                Required. GitHub release tag, for example v0.1.6.
#   $2 REPO               Optional. GitHub repo slug, for example Laplace-bit/GT-Office.
#                         If omitted, the script derives it from `git remote get-url origin`.
#   $3 RELEASE_NOTES_PATH Optional. Defaults to docs/releases/<tag>.md.
#
# Environment variables:
#   SKIP_INSTALL=1        Optional. Skip `npm ci`.
#   SKIP_CHECKS=1         Optional. Skip `npm run typecheck` and `cargo check --workspace`.

set -euo pipefail

TAG="${1:-}"
REPO="${2:-}"
RELEASE_NOTES_PATH="${3:-}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_CHECKS="${SKIP_CHECKS:-0}"

if [[ -z "$TAG" ]]; then
  echo "Usage: scripts/release/build-and-upload-linux.sh <tag> [repo] [release-notes-path]" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script must run on Linux to build .deb artifacts." >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

resolve_repo() {
  if [[ -n "$REPO" ]]; then
    printf '%s\n' "$REPO"
    return
  fi

  local remote_url
  remote_url="$(git remote get-url origin)"
  remote_url="${remote_url%.git}"
  remote_url="${remote_url#git@github.com:}"
  remote_url="${remote_url#https://github.com/}"

  if [[ "$remote_url" == */* ]]; then
    printf '%s\n' "$remote_url"
    return
  fi

  echo "Unable to derive GitHub repo slug from origin remote. Pass it as the second argument." >&2
  exit 1
}

require_command git
require_command gh
require_command node
require_command cargo

if [[ -z "$RELEASE_NOTES_PATH" ]]; then
  RELEASE_NOTES_PATH="docs/releases/${TAG}.md"
fi

if [[ ! -f "$RELEASE_NOTES_PATH" ]]; then
  echo "Release notes file not found: $RELEASE_NOTES_PATH" >&2
  exit 1
fi

RESOLVED_REPO="$(resolve_repo)"

if [[ "$SKIP_INSTALL" != "1" ]]; then
  npm ci
fi

if [[ "$SKIP_CHECKS" != "1" ]]; then
  npm run typecheck
  cargo check --workspace
fi

node scripts/run-tauri-with-env.cjs build --bundles appimage,deb

mapfile -t ASSETS < <(find target/linux/release/bundle -type f \( -name '*.deb' -o -name '*.AppImage' \) | sort)

if [[ "${#ASSETS[@]}" -eq 0 ]]; then
  echo "No Linux release assets were found under target/linux/release/bundle" >&2
  exit 1
fi

if ! gh release view "$TAG" --repo "$RESOLVED_REPO" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$RESOLVED_REPO" --notes-file "$RELEASE_NOTES_PATH"
fi

gh release upload "$TAG" --repo "$RESOLVED_REPO" --clobber "${ASSETS[@]}"

echo "Uploaded Linux assets for $TAG to $RESOLVED_REPO"
