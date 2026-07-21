import { useCallback, useState } from 'react'

import {
  checkpointDesignerTurn,
  ensureDesignerAgentStation,
  renderDesignerScenarioPrompt,
} from './designerDesktopApi'
import { traceDesignerIpc } from './designerIpcTrace'
import type {
  DesignerAgentStation,
  DesignerScenario,
} from '../model/designer-agent-station'

interface UseDesignerAgentStationInput {
  workspaceId: string | null
}

interface RenderScenarioParams {
  documentId: string
  scenario: DesignerScenario
  hostBlockId?: string | null
  userPrompt?: string | null
}

export interface DesignerAgentStationController {
  station: DesignerAgentStation | null
  ensuring: boolean
  error: string | null
  ensure: () => Promise<DesignerAgentStation | null>
  renderScenario: (params: RenderScenarioParams) => Promise<string | null>
  checkpointTurn: (documentId: string, message?: string | null) => Promise<void>
}

/**
 * Controller for the designer agent station (sub-project B). Covers station
 * profile lifecycle + scenario prompt composition + per-turn checkpoint.
 * The terminal session itself is launched via the station/terminal infra.
 */
export function useDesignerAgentStation({
  workspaceId,
}: UseDesignerAgentStationInput): DesignerAgentStationController {
  const [station, setStation] = useState<DesignerAgentStation | null>(null)
  const [ensuring, setEnsuring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensure = useCallback(async () => {
    if (!workspaceId) {
      return null
    }
    setEnsuring(true)
    try {
      const result = await traceDesignerIpc('business_designer.ensure_agent_station', (traceId) =>
        ensureDesignerAgentStation(workspaceId, traceId),
      )
      setStation(result.agent)
      setError(null)
      return result.agent
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setEnsuring(false)
    }
  }, [workspaceId])

  const renderScenario = useCallback(
    async (params: RenderScenarioParams) => {
      if (!workspaceId) {
        return null
      }
      try {
        const result = await traceDesignerIpc(
          'business_designer.render_scenario_prompt',
          (traceId) =>
            renderDesignerScenarioPrompt(
              workspaceId,
              params.documentId,
              params.scenario,
              params.hostBlockId ?? null,
              params.userPrompt ?? null,
              traceId,
            ),
        )
        setError(null)
        return result.prompt
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      }
    },
    [workspaceId],
  )

  const checkpointTurn = useCallback(
    async (documentId: string, message: string | null = null) => {
      if (!workspaceId) {
        return
      }
      try {
        await traceDesignerIpc('business_designer.checkpoint_turn', (traceId) =>
          checkpointDesignerTurn(workspaceId, documentId, message, traceId),
        )
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId],
  )

  return { station, ensuring, error, ensure, renderScenario, checkpointTurn }
}
