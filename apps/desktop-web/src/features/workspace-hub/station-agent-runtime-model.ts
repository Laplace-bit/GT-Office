import type { StationToolKind } from './station-model.js'

export interface StationTerminalProcessInfo {
  pid: number
  parentPid: number | null
  executable: string
  args: string
  depth: number
}

export interface StationTerminalProcessSnapshot {
  sessionId: string
  rootPid: number | null
  currentProcess: StationTerminalProcessInfo | null
  processes: StationTerminalProcessInfo[]
}

const toolProcessMarkers: Record<StationToolKind, string[]> = {
  claude: ['claude', 'claude-code', '@anthropic-ai/claude-code'],
  codex: ['codex', 'openai/codex', '@openai/codex'],
  gemini: ['gemini', 'gemini-cli', '@google/gemini-cli'],
  shell: [],
  unknown: [],
}

function normalizeProcessHaystack(process: StationTerminalProcessInfo): string {
  return [process.executable, process.args].join(' ').toLowerCase()
}

export function resolveStationCliLaunchCommand(
  toolKind: StationToolKind,
  launchCommand?: string | null,
): string | null {
  if (launchCommand?.trim()) {
    return launchCommand.trim()
  }
  if (toolKind === 'claude' || toolKind === 'codex' || toolKind === 'gemini') {
    return toolKind
  }
  return null
}

export function matchesStationToolProcess(
  toolKind: StationToolKind,
  process: StationTerminalProcessInfo | null | undefined,
): boolean {
  if (!process) {
    return false
  }
  const markers = toolProcessMarkers[toolKind]
  if (markers.length === 0) {
    return false
  }
  const haystack = normalizeProcessHaystack(process)
  return markers.some((marker) => haystack.includes(marker))
}

export function isStationAgentProcessRunning(
  toolKind: StationToolKind,
  snapshot: StationTerminalProcessSnapshot | null | undefined,
): boolean {
  if (!snapshot) {
    return false
  }
  if (matchesStationToolProcess(toolKind, snapshot.currentProcess)) {
    return true
  }
  return snapshot.processes.some((process) => matchesStationToolProcess(toolKind, process))
}
