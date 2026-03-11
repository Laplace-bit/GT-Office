#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_FILE="${GTO_MCP_RUNTIME_FILE:-$HOME/.gtoffice/mcp/runtime.json}"
LOG_DIR="${ROOT_DIR}/temp"
LOG_FILE="${LOG_DIR}/mcp-e2e-tauri.log"
PROBE_BOOT_LOG="${LOG_DIR}/mcp-e2e-probe-bootstrap.log"
RUNTIME_WAIT_SECONDS="${GTO_MCP_E2E_RUNTIME_TIMEOUT_SEC:-420}"
HEALTH_WAIT_SECONDS="${GTO_MCP_E2E_HEALTH_TIMEOUT_SEC:-120}"
PROBE_WORKSPACE_PATH="${GTO_E2E_WORKSPACE_PATH:-${ROOT_DIR}}"
PROBE_MANAGER_AGENT_ID="${GTO_E2E_MANAGER_AGENT_ID:-probe-manager}"
PROBE_TARGETS="${GTO_E2E_TARGETS:-probe-worker-1}"
SKIP_BOOTSTRAP="${GTO_E2E_SKIP_BOOTSTRAP:-0}"

mkdir -p "${LOG_DIR}"

runtime_mtime_ms() {
  node -e "const fs=require('node:fs');try{process.stdout.write(String(Math.floor(fs.statSync(process.argv[1]).mtimeMs)));}catch{process.stdout.write('missing');}" "$1"
}

RUNTIME_MTIME_BEFORE="$(runtime_mtime_ms "${RUNTIME_FILE}")"

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

for _ in $(seq 1 "${RUNTIME_WAIT_SECONDS}"); do
  if [[ -f "${RUNTIME_FILE}" ]]; then
    RUNTIME_MTIME_AFTER="$(runtime_mtime_ms "${RUNTIME_FILE}")"
    if [[ "${RUNTIME_MTIME_BEFORE}" == "missing" || "${RUNTIME_MTIME_AFTER}" != "${RUNTIME_MTIME_BEFORE}" ]]; then
      break
    fi
  fi
  sleep 1
done

if [[ ! -f "${RUNTIME_FILE}" ]]; then
  echo "[mcp-e2e] runtime file not found after waiting: ${RUNTIME_FILE}" >&2
  echo "[mcp-e2e] tauri log: ${LOG_FILE}" >&2
  exit 1
fi

RUNTIME_MTIME_AFTER="$(runtime_mtime_ms "${RUNTIME_FILE}")"
if [[ "${RUNTIME_MTIME_BEFORE}" != "missing" && "${RUNTIME_MTIME_AFTER}" == "${RUNTIME_MTIME_BEFORE}" ]]; then
  echo "[mcp-e2e] runtime file was not refreshed by this run: ${RUNTIME_FILE}" >&2
  echo "[mcp-e2e] tauri log: ${LOG_FILE}" >&2
  exit 1
fi

echo "[mcp-e2e] runtime refreshed: ${RUNTIME_FILE}"

BOOTSTRAP_READY=0
for _ in $(seq 1 "${HEALTH_WAIT_SECONDS}"); do
  if node tools/gto-agent-mcp/bin/gto-agent-mcp-probe.mjs >"${PROBE_BOOT_LOG}" 2>&1; then
    BOOTSTRAP_READY=1
    break
  fi
  sleep 1
done

if [[ "${BOOTSTRAP_READY}" -ne 1 ]]; then
  echo "[mcp-e2e] runtime refreshed but bridge health probe never became ready" >&2
  echo "[mcp-e2e] tauri log: ${LOG_FILE}" >&2
  echo "[mcp-e2e] probe log: ${PROBE_BOOT_LOG}" >&2
  exit 1
fi

echo "[mcp-e2e] bridge health probe ready"

PROBE_ARGS=()
if [[ "${SKIP_BOOTSTRAP}" == "1" ]]; then
  echo "[mcp-e2e] GTO_E2E_SKIP_BOOTSTRAP=1, run health-only probe"
else
  PROBE_ARGS+=(
    --bootstrap
    --dispatch
    --handover
    --workspace-path "${PROBE_WORKSPACE_PATH}"
    --manager-agent-id "${PROBE_MANAGER_AGENT_ID}"
    --targets "${PROBE_TARGETS}"
  )
  if [[ -n "${GTO_E2E_WORKSPACE_ID:-}" ]]; then
    PROBE_ARGS+=(--workspace-id "${GTO_E2E_WORKSPACE_ID}")
  fi
fi

cd "${ROOT_DIR}"
node tools/gto-agent-mcp/bin/gto-agent-mcp-probe.mjs "${PROBE_ARGS[@]}"

echo "[mcp-e2e] done"
