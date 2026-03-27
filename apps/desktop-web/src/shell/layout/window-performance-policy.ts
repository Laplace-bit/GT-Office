export type WindowPlatform = 'macos' | 'linux' | 'windows' | 'web'

export interface WindowPerformancePolicyInput {
  tauriRuntime: boolean
  isMacOs: boolean
  isLinux: boolean
}

export interface WindowPerformancePolicy {
  platform: WindowPlatform
  useCustomWindowChrome: boolean
  shouldUseNativeDecorations: boolean
  stationProcessPollIntervalMs: number
  shouldPollAllLiveStationProcesses: boolean
}

const DEFAULT_STATION_PROCESS_POLL_INTERVAL_MS = 1400
const LINUX_STATION_PROCESS_POLL_INTERVAL_MS = 3200

export function resolveWindowPerformancePolicy(
  input: WindowPerformancePolicyInput,
): WindowPerformancePolicy {
  if (!input.tauriRuntime) {
    return {
      platform: 'web',
      useCustomWindowChrome: false,
      shouldUseNativeDecorations: false,
      stationProcessPollIntervalMs: DEFAULT_STATION_PROCESS_POLL_INTERVAL_MS,
      shouldPollAllLiveStationProcesses: true,
    }
  }

  if (input.isMacOs) {
    return {
      platform: 'macos',
      useCustomWindowChrome: true,
      shouldUseNativeDecorations: true,
      stationProcessPollIntervalMs: DEFAULT_STATION_PROCESS_POLL_INTERVAL_MS,
      shouldPollAllLiveStationProcesses: true,
    }
  }

  if (input.isLinux) {
    return {
      platform: 'linux',
      useCustomWindowChrome: false,
      shouldUseNativeDecorations: true,
      stationProcessPollIntervalMs: LINUX_STATION_PROCESS_POLL_INTERVAL_MS,
      shouldPollAllLiveStationProcesses: false,
    }
  }

  return {
    platform: 'windows',
    useCustomWindowChrome: true,
    shouldUseNativeDecorations: false,
    stationProcessPollIntervalMs: DEFAULT_STATION_PROCESS_POLL_INTERVAL_MS,
    shouldPollAllLiveStationProcesses: true,
  }
}
