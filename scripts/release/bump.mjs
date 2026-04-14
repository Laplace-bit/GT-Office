#!/usr/bin/env node

/**
 * GT Office release version bumper.
 *
 * Usage:
 *   node scripts/release/bump.mjs [patch|minor|major] [--dry-run]
 *
 * Defaults to `patch` if no bump type is given.
 * `--dry-run` prints what would happen without modifying files or running git commands.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  applyReleaseVersionsToPackageLock,
  bumpVersion,
  resolveReleaseBaseTag,
} from "./bump-model.mjs";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ok = (msg) => console.log(`${GREEN}${msg}${RESET}`);
const err = (msg) => console.error(`${RED}${msg}${RESET}`);
const warn = (msg) => console.warn(`${YELLOW}${msg}${RESET}`);
const info = (msg) => console.log(`${CYAN}${msg}${RESET}`);

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FILES = {
  rootPkg: resolve(ROOT, "package.json"),
  rootLock: resolve(ROOT, "package-lock.json"),
  tauriPkg: resolve(ROOT, "apps/desktop-tauri/package.json"),
  tauriConf: resolve(ROOT, "apps/desktop-tauri/src-tauri/tauri.conf.json"),
  tauriCargo: resolve(ROOT, "apps/desktop-tauri/src-tauri/Cargo.toml"),
  rootCargo: resolve(ROOT, "Cargo.toml"),
  sharedTypesPkg: resolve(ROOT, "packages/shared-types/package.json"),
  gtoPkg: resolve(ROOT, "tools/gto/package.json"),
  changelog: resolve(ROOT, "CHANGELOG.md"),
  releasesDir: resolve(ROOT, "docs/releases"),
};

const RELEASE_LOCKFILE_WORKSPACES = [
  "apps/desktop-tauri",
  "packages/shared-types",
  "tools/gto",
];

// ── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpType = args.filter((a) => a !== "--dry-run")[0] || "patch";

if (!["patch", "minor", "major"].includes(bumpType)) {
  err(`Invalid bump type: ${bumpType}. Use patch, minor, or major.`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, { allowDryRun = false } = {}) {
  if (dryRun && !allowDryRun) {
    info(`  [dry-run] would run: ${cmd}`);
    return "";
  }
  return execSync(cmd, { encoding: "utf-8", cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJSON(path, data) {
  if (dryRun) {
    info(`  [dry-run] would write: ${path}`);
    return;
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function failPrecheck(message) {
  if (dryRun) {
    warn(`${message} Continuing because --dry-run is read-only.`);
    return;
  }
  err(message);
  process.exit(1);
}

/**
 * Replace a version field in a TOML file using simple regex.
 * For root Cargo.toml: finds `version = "..."` under `[workspace.package]`.
 * For tauri Cargo.toml: finds the first `version = "..."` under `[package]`.
 */
function setTomlVersion(path, newVersion, section) {
  if (dryRun) {
    info(`  [dry-run] would update version to ${newVersion} in ${path}`);
    return;
  }
  let content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  let inSection = false;
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed === section;
      continue;
    }
    if (inSection && /^\s*version\s*=\s*"[^"]*"/.test(lines[i])) {
      lines[i] = lines[i].replace(/version\s*=\s*"[^"]*"/, `version = "${newVersion}"`);
      updated = true;
      break;
    }
  }

  if (!updated) {
    err(`  Failed to find version under ${section} in ${path}`);
    process.exit(1);
  }

  writeFileSync(path, lines.join("\n"), "utf-8");
}

// ── Step 1: Pre-checks ───────────────────────────────────────────────────────

info("\n=== Pre-checks ===\n");

// 1a. Clean working tree
const porcelain = run("git status --porcelain", { allowDryRun: true });
if (porcelain) {
  failPrecheck("Working tree is not clean. Commit or stash your changes first.");
} else {
  ok("  Working tree is clean.");
}

// 1b. On main branch
const branch = run("git rev-parse --abbrev-ref HEAD", { allowDryRun: true });
if (branch !== "main") {
  failPrecheck(`Not on main branch (currently on ${branch}).`);
} else {
  ok("  On main branch.");
}

// 1c. Up to date with origin/main
run("git fetch origin main", { allowDryRun: true });
const localHead = run("git rev-parse HEAD", { allowDryRun: true });
const remoteHead = run("git rev-parse origin/main", { allowDryRun: true });
if (localHead !== remoteHead) {
  failPrecheck("Local main is not up to date with origin/main. Pull first.");
} else {
  ok("  Local is up to date with origin/main.");
}

// ── Step 2: Version bump ─────────────────────────────────────────────────────

info("\n=== Version bump ===\n");

const rootPkg = readJSON(FILES.rootPkg);
const currentVersion = rootPkg.version;
let newVersion;
try {
  newVersion = bumpVersion(currentVersion, bumpType);
} catch (error) {
  err(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

ok(`  ${currentVersion} -> ${newVersion} (${bumpType})`);

// ── Step 3: Write new version to all target files ───────────────────────────

info("\n=== Updating files ===\n");

// 3a. Root package.json
rootPkg.version = newVersion;
writeJSON(FILES.rootPkg, rootPkg);
ok(`  ${relative(FILES.rootPkg)} -> ${newVersion}`);

// 3b. Root package-lock.json
const rootLock = readJSON(FILES.rootLock);
applyReleaseVersionsToPackageLock(rootLock, newVersion, RELEASE_LOCKFILE_WORKSPACES);
writeJSON(FILES.rootLock, rootLock);
ok(`  ${relative(FILES.rootLock)} -> ${newVersion}`);

// 3c. apps/desktop-tauri/package.json
const tauriPkg = readJSON(FILES.tauriPkg);
tauriPkg.version = newVersion;
writeJSON(FILES.tauriPkg, tauriPkg);
ok(`  ${relative(FILES.tauriPkg)} -> ${newVersion}`);

// 3d. apps/desktop-tauri/src-tauri/tauri.conf.json
const tauriConf = readJSON(FILES.tauriConf);
tauriConf.version = newVersion;
writeJSON(FILES.tauriConf, tauriConf);
ok(`  ${relative(FILES.tauriConf)} -> ${newVersion}`);

// 3e. apps/desktop-tauri/src-tauri/Cargo.toml — [package] version
setTomlVersion(FILES.tauriCargo, newVersion, "[package]");
ok(`  ${relative(FILES.tauriCargo)} -> ${newVersion}`);

// 3f. Root Cargo.toml — [workspace.package] version
setTomlVersion(FILES.rootCargo, newVersion, "[workspace.package]");
ok(`  ${relative(FILES.rootCargo)} -> ${newVersion}`);

// 3g. packages/shared-types/package.json
const sharedTypesPkg = readJSON(FILES.sharedTypesPkg);
sharedTypesPkg.version = newVersion;
writeJSON(FILES.sharedTypesPkg, sharedTypesPkg);
ok(`  ${relative(FILES.sharedTypesPkg)} -> ${newVersion}`);

// 3h. tools/gto/package.json
const gtoPkg = readJSON(FILES.gtoPkg);
gtoPkg.version = newVersion;
writeJSON(FILES.gtoPkg, gtoPkg);
ok(`  ${relative(FILES.gtoPkg)} -> ${newVersion}`);

// ── Step 4: Generate CHANGELOG ───────────────────────────────────────────────

info("\n=== Generating CHANGELOG ===\n");

// 4a. Find previous tag
const tagsRaw = run("git tag --sort=-v:refname", { allowDryRun: true });
const tags = tagsRaw ? tagsRaw.split("\n").filter(Boolean) : [];
const latestTag = tags[0] || null;
const baseTag = resolveReleaseBaseTag(tags);

info(`  Latest tag: ${latestTag || "(none)"}`);
info(`  Changelog base tag: ${baseTag || "(none)"}`);

// 4b. Collect commits
const logRange = baseTag ? `${baseTag}..HEAD` : undefined;
const logCmd = logRange
  ? `git log --oneline ${logRange}`
  : "git log --oneline";
const logOutput = run(logCmd, { allowDryRun: true });
const commits = logOutput
  ? logOutput.split("\n").filter(Boolean)
  : [];

if (commits.length === 0) {
  warn("  No commits found since previous tag.");
}

const changelogLines = commits.map((line) => `- ${line}`).join("\n");

// 4c. Write docs/releases/vX.Y.Z.md
const releaseNoteContent = `# v${newVersion}\n\n${changelogLines || "- (no commits recorded)"}\n`;
const releaseNotePath = resolve(FILES.releasesDir, `v${newVersion}.md`);

if (dryRun) {
  info(`  [dry-run] would write: ${relative(releaseNotePath)}`);
  info(`  [dry-run] content:\n${releaseNoteContent}`);
} else {
  if (!existsSync(FILES.releasesDir)) {
    mkdirSync(FILES.releasesDir, { recursive: true });
  }
  writeFileSync(releaseNotePath, releaseNoteContent, "utf-8");
  ok(`  ${relative(releaseNotePath)} written.`);
}

// 4d. Prepend to CHANGELOG.md
const today = new Date().toISOString().slice(0, 10);
const changelogEntry = `## v${newVersion} (${today})\n\n${changelogLines || "- (no commits recorded)"}\n`;

if (dryRun) {
  info(`  [dry-run] would prepend to ${relative(FILES.changelog)}:`);
  info(`\n${changelogEntry}\n`);
} else {
  let existingChangelog = "";
  if (existsSync(FILES.changelog)) {
    existingChangelog = readFileSync(FILES.changelog, "utf-8");
  }
  const newChangelog = existingChangelog
    ? `${changelogEntry}\n${existingChangelog}`
    : `${changelogEntry}\n`;
  writeFileSync(FILES.changelog, newChangelog, "utf-8");
  ok(`  ${relative(FILES.changelog)} updated.`);
}

// ── Step 5: Pause for user review ────────────────────────────────────────────

info("\n=== Review ===\n");

console.log(
  `${BOLD}Version bumped to v${newVersion}.${RESET} Review changes with: ${CYAN}git diff${RESET}`
);
console.log(`Edit CHANGELOG or release notes if needed.`);
console.log(`${BOLD}Press Enter to commit and tag, or Ctrl+C to abort.${RESET}\n`);

if (dryRun) {
  info("[dry-run] Skipping interactive prompt. No commits or tags will be created.");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let reviewConfirmed = false;

rl.on("close", () => {
  if (reviewConfirmed) {
    return;
  }
  warn("\nAborted. Working tree has uncommitted changes. Run `git restore .` to undo.");
  process.exit(0);
});

rl.question("", () => {
  reviewConfirmed = true;
  rl.close();

  // ── Step 6: Commit and tag ──────────────────────────────────────────────────

  info("\n=== Committing and tagging ===\n");

  const filesToStage = [
    FILES.rootPkg,
    FILES.rootLock,
    FILES.tauriPkg,
    FILES.tauriConf,
    FILES.tauriCargo,
    FILES.rootCargo,
    FILES.sharedTypesPkg,
    FILES.gtoPkg,
    FILES.changelog,
    releaseNotePath,
  ]
    .map((f) => `"${f}"`)
    .join(" ");

  try {
    run(`git add ${filesToStage}`);
    ok("  Files staged.");

    run(`git commit -m "Release v${newVersion}"`);
    ok(`  Commit created: Release v${newVersion}`);

    run(`git tag v${newVersion}`);
    ok(`  Tag created: v${newVersion}`);

    console.log("");
    ok(`${BOLD}Release commit and tag created.${RESET}`);
    info(`To push:  ${CYAN}git push && git push --tags${RESET}`);
  } catch (e) {
    err(`  Git operation failed: ${e.message}`);
    process.exit(1);
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────

function relative(absPath) {
  return absPath.startsWith(ROOT) ? absPath.slice(ROOT.length + 1) : absPath;
}
