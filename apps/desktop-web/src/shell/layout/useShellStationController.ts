import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  mapAgentProfileToStation,
  type AgentStation,
  type CreateStationInput,
  type UpdateStationInput,
} from '@features/workspace-hub'
import { resolveStationMutationErrorMessage } from '@features/workspace-hub/station-mutation-error'
import { buildRoleWorkdirRel } from '@features/workspace'
import { desktopApi, type AgentRole } from '../integration/desktop-api'
import type { Locale } from '../i18n/ui-locale'
import {
  createInitialStationTerminals,
  createStationFromNumber,
  getStationIdleBanner,
  normalizeStationWorkdirInput,
  type StationTerminalRuntime,
} from './ShellRoot.shared'

interface UseShellStationControllerInput {
  initialStations: AgentStation[]
  activeWorkspaceId: string | null
  localeRef: MutableRefObject<Locale>
  stationCounterRef: MutableRefObject<number>
  stationTerminalOutputCacheRef: MutableRefObject<Record<string, string>>
  setStationTerminals: Dispatch<SetStateAction<Record<string, StationTerminalRuntime>>>
  setActiveStationId: Dispatch<SetStateAction<string>>
  setIsStationManageOpen: Dispatch<SetStateAction<boolean>>
  setEditingStation: Dispatch<SetStateAction<UpdateStationInput | null>>
}

export interface ShellStationController {
  stations: AgentStation[]
  setStations: Dispatch<SetStateAction<AgentStation[]>>
  agentRoles: AgentRole[]
  stationSavePending: boolean
  loadStationsFromDatabase: (workspaceId: string) => Promise<void>
  addStation: (input: CreateStationInput) => Promise<void>
  updateStation: (stationId: string, input: CreateStationInput) => Promise<void>
}

export function useShellStationController({
  initialStations,
  activeWorkspaceId,
  localeRef,
  stationCounterRef,
  stationTerminalOutputCacheRef,
  setStationTerminals,
  setActiveStationId,
  setIsStationManageOpen,
  setEditingStation,
}: UseShellStationControllerInput): ShellStationController {
  const [stations, setStations] = useState<AgentStation[]>(initialStations)
  const [agentRoles, setAgentRoles] = useState<AgentRole[]>([])
  const [stationSavePending, setStationSavePending] = useState(false)

  const loadStationsFromDatabase = useCallback(async (workspaceId: string) => {
    const [roleResponse, agentResponse] = await Promise.all([
      desktopApi.agentRoleList(workspaceId),
      desktopApi.agentList(workspaceId),
    ])
    const activeRoles = roleResponse.roles.filter((role) => role.status !== 'disabled')
    const roleMap = new Map(activeRoles.map((role) => [role.id, role]))
    setAgentRoles(activeRoles)
    setStations(
      agentResponse.agents
        .map((agent) => mapAgentProfileToStation(agent, roleMap))
        .filter((station): station is AgentStation => station !== null),
    )
  }, [])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      setAgentRoles([])
      return
    }
    if (!activeWorkspaceId) {
      setAgentRoles([])
      setStations([])
      return
    }
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
            roleId: input.roleId,
            tool: input.tool,
            workdir: input.workdir,
            customWorkdir: input.customWorkdir,
            state: 'ready',
            promptContent: input.promptContent,
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
      setStationTerminals((prev) => ({
        ...prev,
        [station.id]: createInitialStationTerminals([station])[station.id],
      }))
      stationTerminalOutputCacheRef.current[station.id] = getStationIdleBanner(station)
      setActiveStationId(station.id)
    },
    [
      activeWorkspaceId,
      agentRoles,
      loadStationsFromDatabase,
      localeRef,
      setActiveStationId,
      setIsStationManageOpen,
      setStationTerminals,
      stationCounterRef,
      stationTerminalOutputCacheRef,
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
            roleId: input.roleId,
            tool: input.tool,
            workdir: input.workdir,
            customWorkdir: input.customWorkdir,
            state: 'ready',
            promptContent: input.promptContent,
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
                roleId: input.roleId,
                role: input.role,
                roleName: input.roleName,
                tool: input.tool,
                agentWorkdirRel: input.workdir,
                roleWorkdirRel: buildRoleWorkdirRel(input.role),
                customWorkdir: input.customWorkdir,
              },
        ),
      )
      setIsStationManageOpen(false)
      setEditingStation(null)
    },
    [
      activeWorkspaceId,
      agentRoles,
      loadStationsFromDatabase,
      localeRef,
      setEditingStation,
      setIsStationManageOpen,
    ],
  )

  return {
    stations,
    setStations,
    agentRoles,
    stationSavePending,
    loadStationsFromDatabase,
    addStation,
    updateStation,
  }
}
