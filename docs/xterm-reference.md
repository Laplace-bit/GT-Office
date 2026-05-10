# xterm.js Local Reference

GT Office already has local xterm.js source installed at:

- `/Users/dzlin/work/GT-Office/node_modules/@xterm/xterm/src`
- parser entry: `/Users/dzlin/work/GT-Office/node_modules/@xterm/xterm/src/common/InputHandler.ts`
- core terminal wiring: `/Users/dzlin/work/GT-Office/node_modules/@xterm/xterm/src/common/CoreTerminal.ts`
- current frontend snapshot capture: `apps/desktop-web/src/features/terminal/StationXtermTerminal.tsx`

For channel/PTy parsing, the xterm visible buffer is the rendering reference:

1. PTY bytes update terminal screen state.
2. Visible rows are derived from that screen state.
3. Channel extraction runs against visible rows, not raw ANSI-stripped text.

Current repository implementation:

- frontend sends xterm-rendered `RenderedScreenSnapshot` rows to Rust
- Rust VT fallback now reconstructs the same snapshot-shaped rows from the PTY parser and reuses the same extraction path
