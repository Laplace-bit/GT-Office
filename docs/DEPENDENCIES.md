# GT Office — Dependencies

This document is the single source of truth for every external dependency the project is allowed to use. Anything not listed here must not be introduced without updating this file and receiving team approval.

Status legend:

- `✅ Used` — present in a current manifest and backed by current code or build usage
- `⏳ Planned` — retained intentionally for upcoming work, not currently present in manifests
- `❌ Unused` — retained for history/audit, not currently present in manifests and should not be reintroduced without re-approval

Scope note:

- Root `package.json` currently contains scripts only and no external npm dependencies.
- Internal workspace crates such as `gt-*` are first-party modules and are not tracked as third-party allowlist entries here.

---

## 1. Policy

- **Milestone-scoped.** Only add dependencies required for the current milestone. Speculative additions are rejected.
- **Allowlist enforced.** Dependencies not recorded in this document are not introduced. Unused or off-list dependencies are removed on discovery.
- **Record-then-add.** Every new dependency must be recorded here before it is added to `package.json` or `Cargo.toml`. The entry must include: name, version constraint, purpose, alternatives considered, and impact scope.
- **Team approval.** Before introducing any new dependency, open a proposal (issue or PR comment) and get at least one other team member to approve.
- **Bundled vs. tree-shaken.** Prefer packages that support tree-shaking or conditional imports. When a package is listed with an asterisk (`@radix-ui/*`), only the specific sub-packages actually used should be installed.
- **Deduplication.** If an existing dependency already provides the capability, do not add a new one. Before proposing a new package, verify that no current dependency can do the job.

---

## 2. Frontend Allowlist

### 2.1 Runtime and Build Dependencies

| Category | Package | Version / Source | Status | Notes |
|---|---|---|---|---|
| UI framework | `react` | `apps/desktop-web/package.json` `^19.2.0` | ✅ Used | Core rendering |
| | `react-dom` | `apps/desktop-web/package.json` `^19.2.0` | ✅ Used | DOM renderer |
| Build toolchain | `vite` | `apps/desktop-web/package.json` `^7.2.4` | ✅ Used | Dev server and bundler |
| | `typescript` | `apps/desktop-web/package.json` `~5.9.3` | ✅ Used | Type system |
| | `eslint` | `apps/desktop-web/package.json` `^9.39.1` | ✅ Used | Linting |
| | `@vitejs/plugin-react` | `apps/desktop-web/package.json` `^5.1.1` | ✅ Used | Vite React integration |
| | `@eslint/js` | `apps/desktop-web/package.json` `^9.39.1` | ✅ Used | ESLint base config |
| | `typescript-eslint` | `apps/desktop-web/package.json` `^8.46.4` | ✅ Used | TypeScript ESLint integration |
| | `eslint-plugin-react-hooks` | `apps/desktop-web/package.json` `^7.0.1` | ✅ Used | React Hooks lint rules |
| | `eslint-plugin-react-refresh` | `apps/desktop-web/package.json` `^0.4.24` | ✅ Used | React Refresh lint rules |
| | `globals` | `apps/desktop-web/package.json` `^16.5.0` | ✅ Used | Shared ESLint globals |
| | `@types/node` | `apps/desktop-web/package.json` `^24.10.1` | ✅ Used | Node type definitions |
| | `@types/react` | `apps/desktop-web/package.json` `^19.2.5` | ✅ Used | React type definitions |
| | `@types/react-dom` | `apps/desktop-web/package.json` `^19.2.3` | ✅ Used | React DOM type definitions |
| Terminal | `@xterm/xterm` | `apps/desktop-web/package.json` `^6.0.0` | ✅ Used | Terminal emulator core |
| | `@xterm/addon-fit` | `apps/desktop-web/package.json` `^0.11.0` | ✅ Used | Auto-fit to container |
| | `@xterm/addon-serialize` | `apps/desktop-web/package.json` `^0.14.0` | ✅ Used | Serialize terminal content |
| | `@xterm/addon-web-links` | not in manifest | ❌ Unused | Previously anticipated, no current install or code usage |
| | `@xterm/addon-clipboard` | `apps/desktop-web/package.json` `^0.2.0` | ✅ Used | Clipboard integration |
| UI components | `@radix-ui/*` | not in manifest | ❌ Unused | No current Radix packages installed |
| | `clsx` | not in manifest | ❌ Unused | No current install |
| | `tailwind-merge` | not in manifest | ❌ Unused | No current install |
| Icons | `lucide-react` | `apps/desktop-web/package.json` `^0.577.0` | ✅ Used | Icon set |
| Command palette | `cmdk` | not in manifest | ❌ Unused | No current install |
| Layout | `react-resizable-panels` | not in manifest | ❌ Unused | No current install |
| | `@dnd-kit/core` | `apps/desktop-web/package.json` `^6.3.1` | ✅ Used | Drag-and-drop core |
| | `@dnd-kit/sortable` | `apps/desktop-web/package.json` `^10.0.0` | ✅ Used | Sortable drag-and-drop |
| | `@dnd-kit/utilities` | `apps/desktop-web/package.json` `^3.2.2` | ✅ Used | DnD utility helpers and transforms |
| File tree | `react-arborist` | `apps/desktop-web/package.json` `^3.5.0` | ✅ Used | Mature virtualized tree with built-in drag/drop for VS Code style file explorer interactions; chosen over extending the custom tree or repurposing `@dnd-kit` for nested tree behavior; scoped to `apps/desktop-web` file explorer |
| State | `@tanstack/react-query` | not in manifest | ❌ Unused | No current install |
| | `zustand` | not in manifest | ❌ Unused | No current install |
| Security | `dompurify` | not in manifest | ❌ Unused | No direct install; lockfile-only transitive presence does not count |
| Validation | `zod` | not in manifest | ❌ Unused | No direct install; lockfile-only transitive presence does not count |
| Styling | `tailwindcss` | `apps/desktop-web/package.json` `^4.1.18` | ✅ Used | Styling pipeline |
| | `postcss` | `apps/desktop-web/package.json` `^8.5.6` | ✅ Used | CSS processing pipeline |
| | `autoprefixer` | `apps/desktop-web/package.json` `^10.4.24` | ✅ Used | Vendor prefixing |
| | `@tailwindcss/postcss` | `apps/desktop-web/package.json` `^4.1.18` | ✅ Used | Tailwind PostCSS plugin |
| | `sass` | `apps/desktop-web/package.json` `^1.97.3` | ✅ Used | SCSS compilation |
| Virtualization | `@tanstack/react-virtual` | `apps/desktop-web/package.json` `^3.13.18` | ✅ Used | Large-list virtualization |
| Animation | `motion` | `apps/desktop-web/package.json` `^12.38.0` | ✅ Used | UI transitions and animated panel interactions |
| Tauri | `@tauri-apps/api` | `apps/desktop-web/package.json` `^2.10.1`, `apps/desktop-tauri/package.json` `^2` | ✅ Used | Tauri JS bindings |
| | `@tauri-apps/cli` | `apps/desktop-tauri/package.json` devDependency `^2` | ✅ Used | Tauri CLI for dev and build |
| | `@tauri-apps/plugin-updater` | `apps/desktop-tauri/package.json` `^2.10.1` | ✅ Used | Native update flow bindings |
| Markdown | `react-markdown` | `apps/desktop-web/package.json` `^10.1.0` | ✅ Used | Markdown rendering |
| | `remark` | not in manifest | ❌ Unused | Base package not directly installed; only `remark-gfm` is installed |
| | `remark-gfm` | `apps/desktop-web/package.json` `^4.0.1` | ✅ Used | GitHub-Flavored Markdown support |
| | `rehype-highlight` | `apps/desktop-web/package.json` `^7.0.2` | ✅ Used | Markdown code block highlighting |
| Syntax highlighting | `shiki` | `apps/desktop-web/package.json` `^3.22.0` | ✅ Used | Syntax highlighting support |
| Code editor | `monaco-editor` | `apps/desktop-web/package.json` `^0.55.1` | ✅ Used | In-app code editor core |
| | `@monaco-editor/react` | `apps/desktop-web/package.json` `^4.7.0` | ✅ Used | React wrapper around Monaco |
| Diff | `diff2html` | `apps/desktop-web/package.json` `^3.4.56` | ✅ Used | HTML diff rendering |
| | `@git-diff-view/react` | `apps/desktop-web/package.json` `^0.0.39` | ✅ Used | Structured Git diff view component |
| | `@git-diff-view/shiki` | `apps/desktop-web/package.json` `^0.0.39` | ✅ Used | Shiki integration for diff rendering |
| Git graph | `@gitgraph/react` | `apps/desktop-web/package.json` `^1.6.0` | ✅ Used | Git history visualization |
| Rich text layout | `@chenglou/pretext` | `apps/desktop-web/package.json` `^0.0.3` | ✅ Used | Message text layout and segment preparation |
| Preview | `react-zoom-pan-pinch` | `apps/desktop-web/package.json` `^3.7.0` | ✅ Used | Image preview pan and zoom |

### 2.2 Future / Reserved Entries

| Category | Package | Version / Source | Status | Notes |
|---|---|---|---|---|
| MCP | `@modelcontextprotocol/sdk` | not in manifest | ⏳ Planned | Reserved for future MCP client integration |
| Collaboration | `yjs` | not in manifest | ⏳ Planned | Reserved for future real-time collaboration |

---

## 3. Rust Crate Allowlist

Core third-party dependencies used by the Tauri shell and workspace crates. Workspace-managed crates are noted as such.

| Category | Crate | Version / Source | Status | Features / Notes |
|---|---|---|---|---|
| Framework | `tauri` | `apps/desktop-tauri/src-tauri/Cargo.toml` `2` | ✅ Used | Core desktop framework |
| | `tauri-build` | `apps/desktop-tauri/src-tauri/Cargo.toml` build-dependency `2` | ✅ Used | Tauri build integration |
| | `tauri-plugin-updater` | `apps/desktop-tauri/src-tauri/Cargo.toml` `2.10.1` | ✅ Used | Native updater plugin |
| Async runtime | `tokio` | workspace dependency `1` | ✅ Used | Async runtime |
| | `tokio-util` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.7` | ✅ Used | Codec and IO helpers |
| | `futures-util` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.3` | ✅ Used | Sink and stream helpers |
| Error handling | `anyhow` | workspace dependency `1` | ✅ Used | General-purpose application errors |
| | `thiserror` | workspace dependency `2` | ✅ Used | Custom error derivation across workspace crates |
| | `async-trait` | workspace dependency `0.1` | ✅ Used | Async traits in abstractions and services |
| Serialization | `serde` | workspace dependency `1` | ✅ Used | Serialization and derive macros |
| | `serde_json` | workspace dependency `1` | ✅ Used | JSON serialization |
| | `bincode` | `apps/desktop-tauri/src-tauri/Cargo.toml` `1.3` | ✅ Used | Binary protocol framing |
| Storage | `rusqlite` | workspace dependency `0.31` with `bundled` | ✅ Used | Embedded SQLite |
| Terminal | `portpicker` | not in current manifests | ❌ Unused | No current install |
| | `vt100` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.15` | ✅ Used | Terminal state parsing and rendered screen recovery |
| | `strip-ansi-escapes` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.2` | ✅ Used | ANSI stripping for normalized output |
| Git | `git2` | `crates/gt-git/Cargo.toml` `0.20` | ✅ Used | Libgit2 bindings for status and diff operations |
| HTTP / networking | `reqwest` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.12` | ✅ Used | HTTP client with `json` and `rustls-tls` |
| | `rustls` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.23` | ✅ Used | TLS backend |
| | `feishu-sdk` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.1.2` | ✅ Used | Feishu connector integration |
| Search / filesystem | `ignore` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.4` | ✅ Used | File tree walking with ignore rules |
| | `grep-regex` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.1` | ✅ Used | Regex engine for search |
| | `grep-searcher` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.1` | ✅ Used | Search execution over workspace files |
| | `notify` | `apps/desktop-tauri/src-tauri/Cargo.toml` `6` | ✅ Used | Filesystem watching |
| File preview | `image` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.25` | ✅ Used | Image preview support |
| | `mime_guess` | `apps/desktop-tauri/src-tauri/Cargo.toml` `2.0` | ✅ Used | MIME type inference |
| | `content_inspector` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.2` | ✅ Used | Text vs binary inspection |
| | `pdfium-render` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.8` | ✅ Used | PDF preview rendering |
| Dialog / UX | `rfd` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.14` | ✅ Used | Native file dialogs |
| | `open` | `apps/desktop-tauri/src-tauri/Cargo.toml` `5.3` | ✅ Used | Open paths and URLs in the system shell |
| Security | `keyring` | not in current manifests | ❌ Unused | No current install |
| Logging | `tracing` | workspace dependency `0.1` | ✅ Used | Structured logging and instrumentation |
| Identity | `uuid` | workspace dependency `1` | ✅ Used | Stable IDs across workspace models |
| Crypto / encoding | `qrcode` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.14` | ✅ Used | QR code generation |
| | `base64` | `apps/desktop-tauri/src-tauri/Cargo.toml` `0.22` | ✅ Used | Base64 encoding and decoding |

---

## 4. Adding a New Dependency

Follow these steps in order. Do not skip any step.

### 4.1 Evaluate

1. **Check existing dependencies.** Verify that no currently-allowed package already provides the capability. Document which packages you considered and why they are insufficient.
2. **Assess size and maintenance.** Prefer small, well-maintained packages with minimal transitive dependencies. Check bundle size (JS) or compile time impact (Rust).
3. **Assess license compatibility.** The project uses Apache-2.0. Ensure the dependency's license is compatible (MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, etc.).

### 4.2 Record

Add an entry to the appropriate allowlist table in this document with:

| Field | Description |
|---|---|
| **Name** | Exact package or crate name |
| **Version** | Version constraint (for example `^5.3.0` or `>=1.0`) |
| **Purpose** | One-line description of what it provides and why it is needed |
| **Alternatives considered** | Which existing or candidate packages were evaluated and rejected |
| **Impact scope** | Which workspace packages or features will use it |

### 4.3 Update manifests

- **npm packages:** add to the relevant `package.json` (root or workspace package).
- **Rust crates:** add to the workspace `Cargo.toml` with appropriate feature flags when they are workspace-wide; use crate-local manifests only when the dependency is truly crate-local.

### 4.4 Verify

Run the full verification suite. All commands must pass before the dependency is considered introduced:

```bash
npm run typecheck
npm run build:web
cargo check --workspace
```

If any command fails, resolve the failure before proceeding. Do not merge a dependency that breaks the build.

---

## 5. Removing Dependencies

When a dependency is no longer used:

1. Update its status in this document.
2. Remove it from `package.json` or `Cargo.toml` if it is no longer needed.
3. Run the verification suite above.
4. Commit the manifest change and this document update in the same commit.

---

## 6. Changelog

| Date | Action | Package | Notes |
|---|---|---|---|
| 2026-04-08 | Created | — | Initial allowlist extracted from project |
| 2026-04-15 | Replaced | codemirror + language packages | Replaced by monaco-editor for VS Code parity |
| 2026-04-15 | Added | monaco-editor, @monaco-editor/react | VS Code editor core for in-app editing |
| 2026-04-18 | Reconciled | frontend and Rust allowlists | Added status markers, aligned tables with current manifests, and recorded missing direct dependencies |
| 2026-05-08 | Added | react-arborist | Replaced bespoke file tree drag/drop behavior with a mature virtualized tree for explorer parity |
