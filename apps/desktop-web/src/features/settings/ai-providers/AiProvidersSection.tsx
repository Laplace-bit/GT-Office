import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import {
  desktopApi,
  type AiAgentInstallStatus,
  type AiAgentSnapshotCard,
  type AiConfigAgent,
  type AiConfigReadSnapshotResponse,
  type AiConfigSnapshot,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { ProviderAgentCard } from './shared/ProviderAgentCard'
import { AgentEnhancementsModal } from './shared/AgentEnhancementsModal'
import { ProviderWorkspaceModal } from './shared/ProviderWorkspaceModal'

import './AiProvidersSection.scss'

interface AiProvidersSectionProps {
  workspaceId?: string | null
  locale: Locale
}

type AgentLoadingMap = Record<AiConfigAgent, boolean>

const AGENT_ORDER: AiConfigAgent[] = ['claude', 'codex', 'gemini']

function createPendingInstallStatus(): AiAgentInstallStatus {
  return {
    installed: false,
    executable: null,
    requiresNode: false,
    nodeReady: false,
    npmReady: false,
    installAvailable: false,
    uninstallAvailable: false,
    detectedBy: [],
    issues: [],
  }
}

function createPendingAgentCard(agent: AiConfigAgent): AiAgentSnapshotCard {
  const titleByAgent: Record<AiConfigAgent, string> = {
    claude: 'aiConfig.agent.claude.title',
    codex: 'aiConfig.agent.codex.title',
    gemini: 'aiConfig.agent.gemini.title',
  }
  const subtitleByAgent: Record<AiConfigAgent, string> = {
    claude: 'aiConfig.agent.claude.subtitle',
    codex: 'aiConfig.agent.codex.subtitle',
    gemini: 'aiConfig.agent.gemini.subtitle',
  }

  return {
    agent,
    title: titleByAgent[agent],
    subtitle: subtitleByAgent[agent],
    installStatus: createPendingInstallStatus(),
    mcpInstalled: false,
    configStatus: 'guidance_only',
    activeSummary: null,
  }
}

function toLoadingMap(snapshot: AiConfigReadSnapshotResponse | null): AgentLoadingMap {
  const loadedAgents = new Set(snapshot?.snapshot.agents.map((agent) => agent.agent) ?? [])
  return {
    claude: !loadedAgents.has('claude'),
    codex: !loadedAgents.has('codex'),
    gemini: !loadedAgents.has('gemini'),
  }
}

export function AiProvidersSection({ workspaceId, locale }: AiProvidersSectionProps) {
  const [snapshot, setSnapshot] = useState<AiConfigReadSnapshotResponse | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [agentLoading, setAgentLoading] = useState<AgentLoadingMap>(() => toLoadingMap(null))
  const [installingAgent, setInstallingAgent] = useState<AiConfigAgent | null>(null)
  const [uninstallingAgent, setUninstallingAgent] = useState<AiConfigAgent | null>(null)
  const [installingMcpAgent, setInstallingMcpAgent] = useState<AiConfigAgent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<AiConfigAgent | null>(null)
  const [configAgentId, setConfigAgentId] = useState<AiConfigAgent | null>(null)
  const [serviceAgentId, setServiceAgentId] = useState<AiConfigAgent | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const reloadTokenRef = useRef(0)

  const handleReload = async (options?: { background?: boolean }) => {
    const token = ++reloadTokenRef.current
    setIsRefreshing(Boolean(options?.background))
    if (!options?.background) {
      setIsInitialLoad(true)
      setAgentLoading(toLoadingMap(null))
    }

    try {
      const data = await desktopApi.aiConfigReadSnapshot(workspaceId)
      if (reloadTokenRef.current !== token) {
        return
      }
      setSnapshot(data)
      setAgentLoading(toLoadingMap(data))
      setActionError(null)
    } catch (err) {
      if (reloadTokenRef.current !== token) {
        return
      }
      console.error('Failed to read AI config snapshot', err)
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      if (reloadTokenRef.current === token) {
        setIsInitialLoad(false)
        setIsRefreshing(false)
      }
    }
  }

  const handleSnapshotUpdate = (effective: AiConfigSnapshot) => {
    startTransition(() => {
      setSnapshot((current) => {
        if (!current) {
          return current
        }
        return {
          ...current,
          snapshot: effective,
        }
      })
    })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSnapshot(null)
    setActionError(null)
    setSelectedAgentId(null)
    setConfigAgentId(null)
    setServiceAgentId(null)
    setIsInitialLoad(true)
    setIsRefreshing(false)
    setAgentLoading(toLoadingMap(null))

    let cancelled = false
    const frameId = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (!cancelled) {
          void handleReload()
        }
      }, 0)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!snapshot || snapshot.snapshot.agents.length === 0) {
      return
    }
    if (!selectedAgentId || !snapshot.snapshot.agents.some((agent) => agent.agent === selectedAgentId)) {
      setSelectedAgentId(snapshot.snapshot.agents[0].agent)
    }
  }, [snapshot, selectedAgentId])

  const handleInstall = async (agent: AiConfigAgent) => {
    setInstallingAgent(agent)
    setActionError(null)
    try {
      await desktopApi.installAgent(agent === 'claude' ? 'ClaudeCode' : agent === 'codex' ? 'Codex' : 'Gemini')
      await handleReload({ background: true })
    } catch (err) {
      console.error('Failed to install agent', err)
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingAgent(null)
    }
  }

  const handleUninstall = async (agent: AiConfigAgent) => {
    setUninstallingAgent(agent)
    setActionError(null)
    try {
      await desktopApi.uninstallAgent(agent === 'claude' ? 'ClaudeCode' : agent === 'codex' ? 'Codex' : 'Gemini')
      await handleReload({ background: true })
    } catch (err) {
      console.error('Failed to uninstall agent', err)
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setUninstallingAgent(null)
    }
  }

  const handleInstallMcp = async (agent: AiConfigAgent) => {
    if (!workspaceId) {
      setActionError(t(locale, '请先打开一个工作区以配置增强服务。', 'Open a workspace before configuring enhancements.'))
      return
    }
    setInstallingMcpAgent(agent)
    setActionError(null)
    try {
      await desktopApi.installAgentMcp(
        agent === 'claude' ? 'ClaudeCode' : agent === 'codex' ? 'Codex' : 'Gemini',
        workspaceId,
      )
      await handleReload({ background: true })
    } catch (err) {
      console.error('Failed to install MCP bridge', err)
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingMcpAgent(null)
    }
  }

  const displayAgents = useMemo(
    () =>
      AGENT_ORDER.map(
        (agentId) =>
          snapshot?.snapshot.agents.find((item) => item.agent === agentId) ?? createPendingAgentCard(agentId),
      ),
    [snapshot],
  )

  const configAgent = snapshot?.snapshot.agents.find((agent) => agent.agent === configAgentId) ?? null

  return (
    <section className="ai-providers-section">
      <header className="ai-providers-section__header">
        {(isInitialLoad || isRefreshing) && (
          <div className="ai-providers-section__refresh-state" aria-live="polite">
            <span className="ai-providers-section__refresh-dot" />
            {t(locale, '正在检查本机环境', 'Checking local environment')}
          </div>
        )}
      </header>

      {actionError && <div className="ai-providers-feedback is-error">{actionError}</div>}

      <div className="ai-providers-grid">
        {displayAgents.map((agent) => (
          <ProviderAgentCard
            key={agent.agent}
            locale={locale}
            agent={agent}
            selected={selectedAgentId === agent.agent}
            statusLoading={agentLoading[agent.agent]}
            onSelect={() => setSelectedAgentId(agent.agent)}
            installingCli={installingAgent === agent.agent}
            uninstallingCli={uninstallingAgent === agent.agent}
            onInstall={() => void handleInstall(agent.agent)}
            onUninstall={() => void handleUninstall(agent.agent)}
            onOpenEnhancements={() => {
              if (!workspaceId) {
                setActionError(
                  t(locale, '请先打开一个工作区以配置增强服务。', 'Open a workspace before configuring enhancements.'),
                )
                return
              }
              setSelectedAgentId(agent.agent)
              setServiceAgentId(agent.agent)
            }}
            onConfigure={() => {
              setSelectedAgentId(agent.agent)
              setConfigAgentId(agent.agent)
            }}
            enhancementDisabled={!workspaceId}
          />
        ))}
      </div>

      {configAgentId === 'claude' && configAgent && snapshot && (
        <ProviderWorkspaceModal
          agentId="claude"
          workspaceId={workspaceId}
          locale={locale}
          agent={configAgent}
          guide={snapshot.snapshot.claude}
          onReload={() => handleReload({ background: true })}
          onSnapshotUpdate={handleSnapshotUpdate}
          onClose={() => setConfigAgentId(null)}
        />
      )}

      {configAgentId === 'codex' && configAgent && snapshot && (
        <ProviderWorkspaceModal
          agentId="codex"
          workspaceId={workspaceId}
          locale={locale}
          agent={configAgent}
          guide={snapshot.snapshot.codex}
          onReload={() => handleReload({ background: true })}
          onSnapshotUpdate={handleSnapshotUpdate}
          onClose={() => setConfigAgentId(null)}
        />
      )}

      {configAgentId === 'gemini' && configAgent && snapshot && (
        <ProviderWorkspaceModal
          agentId="gemini"
          workspaceId={workspaceId}
          locale={locale}
          agent={configAgent}
          guide={snapshot.snapshot.gemini}
          onReload={() => handleReload({ background: true })}
          onSnapshotUpdate={handleSnapshotUpdate}
          onClose={() => setConfigAgentId(null)}
        />
      )}

      {serviceAgentId && snapshot && (
        <AgentEnhancementsModal
          locale={locale}
          agent={snapshot.snapshot.agents.find((item) => item.agent === serviceAgentId) ?? null}
          installingMcp={installingMcpAgent === serviceAgentId}
          onInstallMcp={() => void handleInstallMcp(serviceAgentId)}
          onClose={() => setServiceAgentId(null)}
        />
      )}
    </section>
  )
}
