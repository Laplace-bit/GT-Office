import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  mapAgentProfileToStation,
  type AgentStation,
  type CreateStationInput,
  type UpdateStationInput,
} from '@features/workspace-hub'
import { resolveStationMutationErrorMessage } from '@features/workspace-hub/station-mutation-error'
import { desktopApi } from '../integration/desktop-api'
import type { Locale } from '../i18n/ui-locale'
import { logPerformanceDebug } from '../state/performance-debug'
import {
  createStationFromNumber,
  normalizeStationWorkdirInput,
} from './ShellRoot.shared'

interface UseShellStationControllerInput {
  initialStations: AgentStation[]
  activeWorkspaceId: string | null
  localeRef: MutableRefObject<Locale>
  stationCounterRef: MutableRefObject<number>
  setActiveStationId: Dispatch<SetStateAction<string>>
  setIsStationManageOpen: Dispatch<SetStateAction<boolean>>
  setEditingStation: Dispatch<SetStateAction<UpdateStationInput | null>>
}

export interface ShellStationController {
  stations: AgentStation[]
  setStations: Dispatch<SetStateAction<AgentStation[]>>
  stationsLoadedWorkspaceId: string | null
  stationSavePending: boolean
  loadStationsFromDatabase: (workspaceId: string) => Promise<void>
  addStation: (input: CreateStationInput) => Promise<void>
  updateStation: (stationId: string, input: CreateStationInput) => Promise<void>
  reorderStations: (orderedIds: string[]) => Promise<void>
}

export function useShellStationController({
  initialStations,
  activeWorkspaceId,
  localeRef,
  stationCounterRef,
  setActiveStationId,
  setIsStationManageOpen,
  setEditingStation,
}: UseShellStationControllerInput): ShellStationController {
  const [stations, setStations] = useState<AgentStation[]>(initialStations)
  const [stationsLoadedWorkspaceId, setStationsLoadedWorkspaceId] = useState<string | null>(null)
  const [stationSavePending, setStationSavePending] = useState(false)
  const latestRequestedWorkspaceIdRef = useRef<string | null>(activeWorkspaceId)

  useEffect(() => {
    latestRequestedWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  const loadStationsFromDatabase = useCallback(async (workspaceId: string) => {
    const startedAt = performance.now()
    latestRequestedWorkspaceIdRef.current = workspaceId
    const agentResponse = await desktopApi.agentList(workspaceId)
    if (latestRequestedWorkspaceIdRef.current !== workspaceId) {
      logPerformanceDebug('workspace-stations', 'drop stale station load result', {
        workspaceId,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return
    }
    setStations(
      agentResponse.agents
        .map((agent) => mapAgentProfileToStation(agent)),
    )
    setStationsLoadedWorkspaceId(workspaceId)
    logPerformanceDebug('workspace-stations', 'loaded station snapshot', {
      workspaceId,
      durationMs: Math.round(performance.now() - startedAt),
      stationCount: agentResponse.agents.length,
    })
  }, [])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      latestRequestedWorkspaceIdRef.current = null
      setStationsLoadedWorkspaceId(null)
      return
    }
    if (!activeWorkspaceId) {
      latestRequestedWorkspaceIdRef.current = null
      setStationsLoadedWorkspaceId(null)
      setStations([])
      return
    }
    setStationsLoadedWorkspaceId(null)
    latestRequestedWorkspaceIdRef.current = activeWorkspaceId
    void loadStationsFromDatabase(activeWorkspaceId).catch((error) => {
      console.error('failed to load agents', error)
    })
  }, [activeWorkspaceId, loadStationsFromDatabase])

  const addStation = useMemo(
    () => async (input: CreateStationInput) => {
      if (normalizeStationWorkdirInput(input.workdir) === null) {
        window.alert(
          localeRef.current === 'zh-CN'
            ? '工作目录必须是工作区内的相对路径，不支持绝对路径或 .. 越界。'
            : 'Work directory must be a workspace-relative path without absolute path or "..".',
        )
        return
      }
      if (desktopApi.isTauriRuntime() && activeWorkspaceId) {
        setStationSavePending(true)
        try {
          await desktopApi.agentCreate({
            workspaceId: activeWorkspaceId,
            name: input.name,
            tool: input.tool,
            workdir: input.workdir,
            customWorkdir: input.customWorkdir,
            state: 'ready',
            promptEnabled: input.promptEnabled,
            promptContent: input.promptContent,
            launchCommand: input.launchCommand,
          })
          await loadStationsFromDatabase(activeWorkspaceId)
          setIsStationManageOpen(false)
        } catch (error) {
          console.error('failed to create agent', error)
          window.alert(resolveStationMutationErrorMessage(localeRef.current, 'create', error))
        } finally {
          setStationSavePending(false)
        }
        return
      }
      const number = stationCounterRef.current
      stationCounterRef.current += 1
      const station = createStationFromNumber(number, activeWorkspaceId, input)
      setStations((prev) => [...prev, station])
      setActiveStationId(station.id)
    },
    [
      activeWorkspaceId,
      loadStationsFromDatabase,
      localeRef,
      setActiveStationId,
      setIsStationManageOpen,
      stationCounterRef,
    ],
  )

  const updateStation = useMemo(
    () => async (stationId: string, input: CreateStationInput) => {
      if (normalizeStationWorkdirInput(input.workdir) === null) {
        window.alert(
          localeRef.current === 'zh-CN'
            ? '工作目录必须是工作区内的相对路径，不支持绝对路径或 .. 越界。'
            : 'Work directory must be a workspace-relative path without absolute path or "..".',
        )
        return
      }
      if (desktopApi.isTauriRuntime() && activeWorkspaceId) {
        setStationSavePending(true)
        try {
          await desktopApi.agentUpdate({
            workspaceId: activeWorkspaceId,
            agentId: stationId,
            name: input.name,
            tool: input.tool,
            workdir: input.workdir,
            customWorkdir: input.customWorkdir,
            state: 'ready',
            promptEnabled: input.promptEnabled,
            promptContent: input.promptContent,
            launchCommand: input.launchCommand,
          })
          await loadStationsFromDatabase(activeWorkspaceId)
          setIsStationManageOpen(false)
          setEditingStation(null)
        } catch (error) {
          console.error('failed to update agent', error)
          window.alert(resolveStationMutationErrorMessage(localeRef.current, 'update', error))
        } finally {
          setStationSavePending(false)
        }
        return
      }
      setStations((prev) =>
        prev.map((station) =>
          station.id !== stationId
            ? station
            : {
                ...station,
                name: input.name,
                tool: input.tool,
                agentWorkdirRel: input.workdir,
                customWorkdir: input.customWorkdir,
              },
        ),
      )
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [
      activeWorkspaceId,
      loadStationsFromDatabase,
      localeRef,
      setEditingStation,
      setIsStationManageOpen,
    ],
  )

  const reorderStations = useMemo(
    () => async (orderedIds: string[]) => {
      // Optimistic local reorder: rearrange existing references, update orderIndex in-place
      setStations((prev) => {
        const stationMap = new Map(prev.map((s) => [s.id, s]))
        const reordered = orderedIds
          .map((id, index) => {
            const station = stationMap.get(id)
            if (!station) return null
            // Only create new object if orderIndex changed
            return station.orderIndex === index + 1
              ? station
              : { ...station, orderIndex: index + 1 }
          })
          .filter((s): s is AgentStation => s !== null)
        // Append any stations not in the ordered list (unchanged references)
        const remaining = prev.filter((s) => !orderedIds.includes(s.id))
        return [...reordered, ...remaining]
      })
      // Persist to backend in the background — no full reload needed
      if (desktopApi.isTauriRuntime() && activeWorkspaceId) {
        desktopApi
          .agentReorder({
            workspaceId: activeWorkspaceId,
            orderedAgentIds: orderedIds,
          })
          .catch((error) => {
            console.error('failed to persist agent reorder', error)
          })
      }
    },
    [activeWorkspaceId],
  )

  return {
    stations,
    setStations,
    stationsLoadedWorkspaceId,
    stationSavePending,
    loadStationsFromDatabase,
    addStation,
    updateStation,
    reorderStations,
  }
}
