#!/usr/bin/env bash
# Compare native CLI startup vs shell+CLI (approximates GT Office terminal path).
set -euo pipefail

bench() {
  local label="$1"
  shift
  local i
  local total=0
  local n="${BENCH_RUNS:-5}"
  for ((i = 1; i <= n; i++)); do
    local start end ms
    start=$(python3 -c 'import time; print(time.perf_counter())')
    "$@" >/dev/null 2>&1 || true
    end=$(python3 -c 'import time; print(time.perf_counter())')
    ms=$(python3 -c "print(int(($end - $start) * 1000))")
    total=$((total + ms))
    echo "  run $i: ${ms}ms"
  done
  echo "$label avg: $((total / n))ms (n=$n)"
}

echo "=== Native one-shot (version only) ==="
bench "claude --version" claude --version
bench "codex --version" codex --version

echo ""
echo "=== Shell non-login + CLI (fast path, like GT Office warm terminal) ==="
bench "zsh -c claude --version" zsh -c "claude --version"
bench "zsh -c codex --version" zsh -c "codex --version"

echo ""
echo "=== Shell login + CLI (legacy slow path) ==="
bench "zsh -lc claude --version" zsh -lc "claude --version"

echo ""
echo "Tip: GT Office target is warm PTY + non-login shell + single command write (<500ms perceived before TUI paints)."
