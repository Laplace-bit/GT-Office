<#
Usage:
  pwsh -File scripts/release/build-and-upload-windows.ps1 -Tag v0.1.6 -Repo Laplace-bit/GT-Office

Parameters:
  -Tag              Required. GitHub release tag, for example v0.1.6.
  -Repo             Optional. GitHub repo slug, for example Laplace-bit/GT-Office.
                    If omitted, the script derives it from `git remote get-url origin`.
  -ReleaseNotesPath Optional. Defaults to docs/releases/<tag>.md.
  -SkipInstall      Optional switch. Skip `npm ci`.
  -SkipChecks       Optional switch. Skip `npm run typecheck` and `cargo check --workspace`.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [string]$Repo = "",
  [string]$ReleaseNotesPath = "",
  [switch]$SkipInstall,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-Repo {
  param([string]$ProvidedRepo)

  if ($ProvidedRepo) {
    return $ProvidedRepo
  }

  $remoteUrl = (git remote get-url origin).Trim()
  if ($remoteUrl -match 'github\.com[:/](.+?)(?:\.git)?$') {
    return $Matches[1]
  }

  throw "Unable to derive GitHub repo slug from origin remote. Pass -Repo owner/name explicitly."
}

function Ensure-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Resolve-NotesPath {
  param([string]$ProvidedPath, [string]$ResolvedTag)

  if ($ProvidedPath) {
    return $ProvidedPath
  }

  return "docs/releases/$ResolvedTag.md"
}

if (-not $IsWindows) {
  throw "This script must run on Windows to build NSIS artifacts."
}

Ensure-Command "git"
Ensure-Command "gh"
Ensure-Command "node"
Ensure-Command "cargo"

$resolvedRepo = Resolve-Repo -ProvidedRepo $Repo
$resolvedNotesPath = Resolve-NotesPath -ProvidedPath $ReleaseNotesPath -ResolvedTag $Tag

if (-not $SkipInstall) {
  npm ci
}

if (-not $SkipChecks) {
  npm run typecheck
  cargo check --workspace
}

node scripts/run-tauri-with-env.cjs build --bundles nsis

$assetRoot = "target/windows/release/bundle"
$assets = Get-ChildItem -Path $assetRoot -Recurse -File | Where-Object {
  $_.Extension -in ".exe", ".msi"
}

if (-not $assets -or $assets.Count -eq 0) {
  throw "No Windows release assets were found under $assetRoot"
}

if (-not (Test-Path $resolvedNotesPath)) {
  throw "Release notes file not found: $resolvedNotesPath"
}

gh release view $Tag --repo $resolvedRepo *> $null
if ($LASTEXITCODE -ne 0) {
  gh release create $Tag --repo $resolvedRepo --notes-file $resolvedNotesPath
}

$assetPaths = $assets | ForEach-Object { $_.FullName }
gh release upload $Tag --repo $resolvedRepo --clobber @assetPaths

Write-Host "Uploaded Windows assets for $Tag to $resolvedRepo"
