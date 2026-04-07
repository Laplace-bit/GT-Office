import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  desktopApi,
  type AiAgentInstallStatus,
  type AiAgentSnapshotCard,
  type AiConfigAgent,
  type AiConfigReadSnapshotResponse,
  type AiConfigSnapshot,
  type GtoCliStatus,
  type GtoSkillStatus,
} from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { ProviderAgentCard } from './shared/ProviderAgentCard'
import { AgentEnhancementsModal } from './shared/AgentEnhancementsModal'
import { ProviderWorkspaceModal } from './shared/ProviderWorkspaceModal'
import { AgentInstallProgressModal } from './shared/AgentInstallProgressModal'

import './AiProvidersSection.scss'

interface AiProvidersSectionProps {
  workspaceId?: string | null
  locale: Locale
}

type AgentLoadingMap = Record<AiConfigAgent, boolean>

const AGENT_ORDER: AiConfigAgent[] = ['claude', 'codex', 'gemini']

const AGENT_DISPLAY_NAMES: Record<AiConfigAgent, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
}

function mapAgentType(agent: AiConfigAgent): 'ClaudeCode' | 'Codex' | 'Gemini' {
  return agent === 'claude' ? 'ClaudeCode' : agent === 'codex' ? 'Codex' : 'Gemini'
}

interface ProgressModalState {
  agentId: AiConfigAgent
  operation: 'install' | 'uninstall'
  promise: Promise<void>
}

interface ConfirmDialogState {
  agentId: AiConfigAgent
  agentName: string
}

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
  const [selectedAgentId, setSelectedAgentId] = useState<AiConfigAgent | null>(null)
  const [configAgentId, setConfigAgentId] = useState<AiConfigAgent | null>(null)
  const [serviceAgentId, setServiceAgentId] = useState<AiConfigAgent | null>(null)
  const [gtoCliStatus, setGtoCliStatus] = useState<GtoCliStatus | null>(null)
  const [gtoSkillStatus, setGtoSkillStatus] = useState<GtoSkillStatus | null>(null)
  const [installingGto, setInstallingGto] = useState(false)
  const [uninstallingGto, setUninstallingGto] = useState(false)
  const [installingSkill, setInstallingSkill] = useState(false)
  const [uninstallingSkill, setUninstallingSkill] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [progressModal, setProgressModal] = useState<ProgressModalState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
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
      const cliStatus = await desktopApi.systemGtoCliStatus().catch(() => null)
      const skillStatus = serviceAgentId
        ? await desktopApi.systemGtoSkillStatus(serviceAgentId).catch(() => null)
        : null
      if (reloadTokenRef.current !== token) {
        return
      }
      setSnapshot(data)
      setGtoCliStatus(cliStatus)
      setGtoSkillStatus(skillStatus)
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
    let cancelled = false

    if (!serviceAgentId) {
      setGtoSkillStatus(null)
      return () => {
        cancelled = true
      }
    }

    void desktopApi
      .systemGtoSkillStatus(serviceAgentId)
      .then((status) => {
        if (!cancelled) {
          setGtoSkillStatus(status)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load gto skill status', err)
          setGtoSkillStatus(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [serviceAgentId])

  const handleInstall = async (agent: AiConfigAgent) => {
    setInstallingAgent(agent)
    setActionError(null)
    const promise = desktopApi.installAgent(mapAgentType(agent))
    setProgressModal({ agentId: agent, operation: 'install', promise })
  }

  const handleInstallCompleted = useCallback((success: boolean) => {
    setInstallingAgent(null)
    if (success) {
      void handleReload({ background: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const requestUninstall = useCallback((agent: AiConfigAgent) => {
    const card = snapshot?.snapshot.agents.find((a) => a.agent === agent)
    const displayName = card
      ? translateMaybeKey(locale, card.title)
      : AGENT_DISPLAY_NAMES[agent]
    setConfirmDialog({ agentId: agent, agentName: displayName })
  }, [locale, snapshot])

  const handleUninstallConfirmed = useCallback((agent: AiConfigAgent) => {
    setConfirmDialog(null)
    setUninstallingAgent(agent)
    setActionError(null)
    const promise = desktopApi.uninstallAgent(mapAgentType(agent))
    setProgressModal({ agentId: agent, operation: 'uninstall', promise })
  }, [])

  const handleUninstallCompleted = useCallback((success: boolean) => {
    setUninstallingAgent(null)
    if (success) {
      void handleReload({ background: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleProgressClose = useCallback(() => {
    setProgressModal(null)
    setInstallingAgent(null)
    setUninstallingAgent(null)
    void handleReload({ background: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstallGto = async () => {
    if (!serviceAgentId) {
      return
    }
    setInstallingGto(true)
    setInstallingSkill(true)
    setActionError(null)
    try {
      const cliStatus = await desktopApi.systemGtoCliInstall()
      const skillStatus = await desktopApi.systemGtoSkillInstall(serviceAgentId)
      setGtoCliStatus(cliStatus)
      setGtoSkillStatus(skillStatus)
    } catch (err) {
      console.error('Failed to install gto CLI', err)
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingGto(false)
      setInstallingSkill(false)
    }
  }

  const handleUninstallGto = async () => {
    setUninstallingGto(true)
    setUninstallingSkill(true)
    setActionError(null)
    try {
      if (serviceAgentId) {
        const skillStatus = await desktopApi.systemGtoSkillUninstall(serviceAgentId)
        setGtoSkillStatus(skillStatus)
      }
      const cliStatus = await desktopApi.systemGtoCliUninstall()
      setGtoCliStatus(cliStatus)
    } catch (err) {
      console.error('Failed to uninstall gto CLI', err)
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setUninstallingGto(false)
      setUninstallingSkill(false)
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
            onUninstall={() => requestUninstall(agent.agent)}
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
          gtoCliStatus={gtoCliStatus}
          gtoSkillStatus={gtoSkillStatus}
          installingGto={installingGto}
          uninstallingGto={uninstallingGto}
          installingSkill={installingSkill}
          uninstallingSkill={uninstallingSkill}
          onInstallGto={() => void handleInstallGto()}
          onUninstallSkill={() => void handleUninstallGto()}
          onClose={() => setServiceAgentId(null)}
        />
      )}

      {progressModal && createPortal(
        <AgentInstallProgressModal
          locale={locale}
          agentId={progressModal.agentId}
          agentName={AGENT_DISPLAY_NAMES[progressModal.agentId]}
          operation={progressModal.operation}
          operationPromise={progressModal.promise}
          onClose={handleProgressClose}
          onCompleted={progressModal.operation === 'install' ? handleInstallCompleted : handleUninstallCompleted}
          onRetry={
            progressModal.operation === 'install'
              ? () => {
                setProgressModal(null)
                handleInstall(progressModal.agentId)
              }
              : undefined
          }
        />,
        document.body,
      )}

      {confirmDialog && createPortal(
        <div className="ai-providers-confirm-overlay" onClick={() => setConfirmDialog(null)}>
          <div
            className="ai-providers-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={t(locale, 'aiConfig.confirm.uninstallTitle')}
          >
            <div className="ai-providers-confirm-dialog__icon">
              <AppIcon name="info" width={24} height={24} />
            </div>
            <h4>{t(locale, 'aiConfig.confirm.uninstallTitle')}</h4>
            <p>{t(locale, 'aiConfig.confirm.uninstallMessage', { name: confirmDialog.agentName })}</p>
            <div className="ai-providers-confirm-dialog__actions">
              <button
                type="button"
                className="ai-providers-confirm-dialog__btn is-cancel"
                onClick={() => setConfirmDialog(null)}
              >
                {t(locale, 'aiConfig.confirm.cancel')}
              </button>
              <button
                type="button"
                className="ai-providers-confirm-dialog__btn is-danger"
                onClick={() => handleUninstallConfirmed(confirmDialog.agentId)}
              >
                {t(locale, 'aiConfig.confirm.proceed')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
