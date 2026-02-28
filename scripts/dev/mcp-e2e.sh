#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_FILE="${GTO_MCP_RUNTIME_FILE:-$HOME/.gtoffice/mcp/runtime.json}"
LOG_DIR="${ROOT_DIR}/temp"
LOG_FILE="${LOG_DIR}/mcp-e2e-tauri.log"

mkdir -p "${LOG_DIR}"

echo "[mcp-e2e] starting desktop tauri dev..."
(
  cd "${ROOT_DIR}"
  npm --workspace apps/desktop-tauri run dev
) >"${LOG_FILE}" 2>&1 &
TAURI_PID=$!

cleanup() {
  if ps -p "${TAURI_PID}" >/dev/null 2>&1; then
    kill "${TAURI_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for _ in $(seq 1 180); do
  if [[ -f "${RUNTIME_FILE}" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -f "${RUNTIME_FILE}" ]]; then
  echo "[mcp-e2e] runtime file not found after waiting: ${RUNTIME_FILE}" >&2
  echo "[mcp-e2e] tauri log: ${LOG_FILE}" >&2
  exit 1
fi

echo "[mcp-e2e] runtime ready: ${RUNTIME_FILE}"

PROBE_ARGS=()
if [[ -n "${GTO_E2E_WORKSPACE_ID:-}" && -n "${GTO_E2E_TARGETS:-}" ]]; then
  PROBE_ARGS+=(--dispatch --handover --workspace-id "${GTO_E2E_WORKSPACE_ID}" --targets "${GTO_E2E_TARGETS}")
else
  echo "[mcp-e2e] GTO_E2E_WORKSPACE_ID/GTO_E2E_TARGETS not set, run health-only probe"
fi

cd "${ROOT_DIR}"
node tools/gto-agent-mcp/bin/gto-agent-mcp-probe.mjs "${PROBE_ARGS[@]}"

echo "[mcp-e2e] done"
