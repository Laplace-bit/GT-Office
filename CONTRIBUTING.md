# Contributing to GT Office

Thank you for your interest in contributing to GT Office! This document covers the essentials for getting started.

## Development Setup

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- **Rust** stable
- **Platform-specific Tauri prerequisites**
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools + WebView2 Runtime
  - Linux: `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`

### Install and Run

```bash
# Install dependencies
npm install

# Run the web UI (frontend only)
npm run dev:web

# Run the desktop shell (full Tauri app)
npm run dev:tauri
```

## Project Structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture overview.

| Directory | Purpose |
|-----------|---------|
| `apps/desktop-web` | React + Vite desktop UI |
| `apps/desktop-tauri` | Tauri shell, native bridge, packaging |
| `crates/` | Rust domain modules |
| `packages/shared-types` | Shared contracts between frontend and backend |
| `tools/` | CLI and local bridge utilities (`gto`) |
| `docs/` | Technical documentation |

## Code Style

### Rust

- Run `cargo fmt --all` before committing
- Run `cargo clippy --workspace` and resolve warnings
- Avoid `unwrap()` in non-trivial paths — use proper error handling
- Add `tracing` instrumentation for key flows
- Tests go in feature `tests/` or crate `tests/`

### TypeScript / React

- Run `npm run typecheck` before committing
- Use SCSS for styling — no raw CSS files
- Use responsive units — avoid `px`
- Follow the existing design system and component patterns
- Keep feature-specific code in `features/<name>/`

## Pull Request Process

1. **Branch naming**: Use `feat/`, `fix/`, `refactor/`, `docs/`, or `chore/` prefixes
2. **Commits**: Write clear, descriptive commit messages
3. **Scope**: One feature or fix per PR
4. **Verification**: Ensure all checks pass before requesting review

### Verification Checklist

Before submitting a PR, verify:

- [ ] `npm run typecheck` passes
- [ ] `cargo check --workspace` passes
- [ ] `npm run build:web` passes
- [ ] No new clippy warnings
- [ ] No new hardcoded strings — use i18n messages

## Reporting Issues

Use GitHub Issues with clear reproduction steps, expected behavior, and actual behavior.

## License

By contributing to GT Office, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).