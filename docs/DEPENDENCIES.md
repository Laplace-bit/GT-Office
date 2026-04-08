# GT Office — Dependencies

This document is the single source of truth for every dependency the project is allowed to use. Anything not listed here must not be introduced without updating this file and receiving team approval.

---

## 1. Policy

- **Milestone-scoped.** Only add dependencies required for the current milestone. speculative additions are rejected.
- **Allowlist enforced.** Dependencies not recorded in this document are not introduced. Unused or off-list dependencies are removed on discovery.
- **Record-then-add.** Every new dependency must be recorded here before it is added to `package.json` or `Cargo.toml`. The entry must include: name, version constraint, purpose, alternatives considered, and impact scope.
- **Team approval.** Before introducing any new dependency, open a proposal (issue or PR comment) and get at least one other team member to approve.
- **Bundled vs. tree-shaken.** Prefer packages that support tree-shaking or conditional imports. When a package is listed with an asterisk (`@radix-ui/*`), only the specific sub-packages actually used should be installed.
- **Deduplication.** If an existing dependency already provides the capability, do not add a new one. Before proposing a new package, verify that no current dependency can do the job.

---

## 2. Frontend Allowlist

### P0 — Current Milestone

| Category | Package | Notes |
|---|---|---|
| UI framework | `react` | Core rendering |
| | `react-dom` | DOM renderer |
| Build toolchain | `vite` | Dev server & bundler |
| | `typescript` | Type system |
| | `eslint` | Linting |
| Terminal | `@xterm/xterm` | Terminal emulator core |
| | `@xterm/addon-fit` | Auto-fit to container |
| | `@xterm/addon-serialize` | Serialize terminal content |
| | `@xterm/addon-web-links` | Clickable URLs |
| | `@xterm/addon-clipboard` | Clipboard integration |
| UI components | `@radix-ui/*` | On-demand primitives only |
| | `clsx` | Conditional class names |
| | `tailwind-merge` | Merge Tailwind classes without conflicts |
| Icons | `lucide-react` | Icon set |
| Command palette | `cmdk` | Keyboard-first command palette |
| Layout | `react-resizable-panels` | Resizable panel layout |
| | `@dnd-kit/core` | Drag-and-drop core |
| | `@dnd-kit/sortable` | Sortable DnD presets |
| State | `@tanstack/react-query` | Async state & caching |
| | `zustand` | Synchronous global state |
| Security | `dompurify` | HTML sanitization |
| Validation | `zod` | Runtime schema validation |
| Styling | `tailwindcss` | Utility-first CSS |
| | `postcss` | CSS processing pipeline |
| | `autoprefixer` | Vendor prefixing |
| | `@tailwindcss/postcss` | Tailwind PostCSS plugin |
| | `sass` | SCSS compilation |
| Virtualization | `@tanstack/react-virtual` | Large-list virtualization |
| Animation | `motion` | Limited to opacity/transform transitions only |
| Tauri | `@tauri-apps/api` | Tauri JS bindings |
| | `@tauri-apps/cli` | Tauri CLI for dev & build |

### P1 — Next Milestone

| Category | Package | Notes |
|---|---|---|
| Syntax highlighting | `shiki` | Multi-language syntax highlighting |
| Code editor | `codemirror` + language packages | In-app code editing |
| Markdown | `remark` | Markdown processor |
| | `remark-gfm` | GitHub-Flavored Markdown support |
| Diff | `diff2html` | Side-by-side diff rendering |
| Git graph | `@gitgraph/react` | Git history visualization |

### P2 — Future

| Category | Package | Notes |
|---|---|---|
| MCP | `@modelcontextprotocol/sdk` | Model Context Protocol client |
| Collaboration | `yjs` | Real-time collaborative editing |

---

## 3. Rust Crates

Core workspace dependencies. All crates are managed through the workspace `Cargo.toml`; feature flags are used to keep binary size minimal.

| Category | Crate | Features / Notes |
|---|---|---|
| Framework | `tauri` | Core desktop framework |
| Async runtime | `tokio` | Async runtime (full features as needed) |
| Serialization | `serde` | Derive macros |
| | `serde_json` | JSON serde |
| Storage | `rusqlite` | `bundled` feature — embedded SQLite |
| Terminal | `portpicker` | Pick free port for PTY |
| Git | `git2` | Libgit2 bindings |
| HTTP | `reqwest` | `json` + `rustls-tls` features — no OpenSSL |
| Security | `keyring` | OS credential store |
| Logging | `tracing` | Structured logging & instrumentation |
| Crypto | `qrcode` | QR code generation |

---

## 4. Adding a New Dependency

Follow these steps in order. Do not skip any step.

### 4.1 Evaluate

1. **Check existing dependencies.** Verify that no currently-allowed package already provides the capability. Document which packages you considered and why they are insufficient.
2. **Assess size and maintenance.** Prefer small, well-maintained packages with minimal transitive dependencies. Check bundle size (JS) or compile time impact (Rust).
3. **Assess license compatibility.** The project uses MIT. Ensure the dependency's license is compatible (MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, etc.).

### 4.2 Record

Add an entry to the appropriate allowlist table in this document with:

| Field | Description |
|---|---|
| **Name** | Exact package or crate name |
| **Version** | Version constraint (e.g. `^5.3.0` or `>=1.0`) |
| **Purpose** | One-line description of what it provides and why it is needed |
| **Alternatives considered** | Which existing or candidate packages were evaluated and rejected |
| **Impact scope** | Which workspace packages / features will use it |

### 4.3 Update manifests

- **npm packages:** add to the relevant `package.json` (root or workspace package).
- **Rust crates:** add to the workspace `Cargo.toml` with appropriate feature flags. Do not add to individual crate manifests unless it is truly crate-local.

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

1. Remove it from this document.
2. Remove it from `package.json` or `Cargo.toml`.
3. Run the verification suite above.
4. Commit both the manifest change and this document update in the same commit.

---

## 6. Changelog

| Date | Action | Package | Notes |
|---|---|---|---|
| 2026-04-08 | Created | — | Initial allowlist extracted from project |