import { startTransition, useEffect, useState } from 'react'

import {
  desktopApi,
  type AiConfigAgent,
  type AiConfigReadSnapshotResponse,
  type AiConfigSnapshot,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { ProviderAgentCard } from './shared/ProviderAgentCard'
import { isLightAgentSnapshotCard } from './shared/provider-utils'
import { AgentEnhancementsModal } from './shared/AgentEnhancementsModal'
import { ClaudeConfigModal } from './claude/ClaudeConfigModal'
import { LightAgentConfigModal } from './light-agents/LightAgentConfigModal'

import './AiProvidersSection.scss'

interface AiProvidersSectionProps {
  workspaceId: string
  locale: Locale
}

type ClaudeConfigEntryMode = 'wizard' | 'saved'

export function AiProvidersSection({ workspaceId, locale }: AiProvidersSectionProps) {
  const [snapshot, setSnapshot] = useState<AiConfigReadSnapshotResponse | null>(null)
  const [installingAgent, setInstallingAgent] = useState<AiConfigAgent | null>(null)
  const [installingMcpAgent, setInstallingMcpAgent] = useState<AiConfigAgent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<AiConfigAgent | null>(null)
  const [configAgentId, setConfigAgentId] = useState<AiConfigAgent | null>(null)
  const [serviceAgentId, setServiceAgentId] = useState<AiConfigAgent | null>(null)
  const [claudeEntryMode, setClaudeEntryMode] = useState<ClaudeConfigEntryMode>('wizard')

  const handleReload = async () => {
    try {
      const data = await desktopApi.aiConfigReadSnapshot(workspaceId)
      setSnapshot(data)
    } catch (err) {
      console.error('Failed to read AI config snapshot', err)
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

  useEffect(() => {
    void handleReload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    if (snapshot && !selectedAgentId && snapshot.snapshot.agents.length > 0) {
      setSelectedAgentId(snapshot.snapshot.agents[0].agent)
    }
  }, [snapshot, selectedAgentId])

  const handleInstall = async (agent: AiConfigAgent) => {
    setInstallingAgent(agent)
    try {
      await desktopApi.installAgent(agent === 'claude' ? 'ClaudeCode' : agent === 'codex' ? 'Codex' : 'Gemini')
      await handleReload()
    } catch (err) {
      console.error('Failed to install agent', err)
    } finally {
      setInstallingAgent(null)
    }
  }

  const handleInstallMcp = async (agent: AiConfigAgent) => {
    setInstallingMcpAgent(agent)
    try {
      await desktopApi.installAgentMcp(agent === 'claude' ? 'ClaudeCode' : agent === 'codex' ? 'Codex' : 'Gemini')
      await handleReload()
    } catch (err) {
      console.error('Failed to install MCP bridge', err)
    } finally {
      setInstallingMcpAgent(null)
    }
  }

  if (!snapshot) {
    return <div className="ai-providers-loading">{t(locale, '加载中...', 'Loading...')}</div>
  }

  const configAgent = snapshot.snapshot.agents.find((a) => a.agent === configAgentId)
  const lightConfigAgent = isLightAgentSnapshotCard(configAgent) ? configAgent : null

  return (
    <section className="ai-providers-section">
      <div className="ai-providers-grid">
        {snapshot.snapshot.agents.map((agent) => (
          <ProviderAgentCard
            key={agent.agent}
            locale={locale}
            agent={agent}
            selected={selectedAgentId === agent.agent}
            onSelect={() => setSelectedAgentId(agent.agent)}
            installingCli={installingAgent === agent.agent}
            onInstall={() => void handleInstall(agent.agent)}
            onOpenEnhancements={() => {
              setSelectedAgentId(agent.agent)
              setServiceAgentId(agent.agent)
            }}
            onConfigure={() => {
              setSelectedAgentId(agent.agent)
              if (agent.agent === 'claude') {
                setClaudeEntryMode('wizard')
              }
              setConfigAgentId(agent.agent)
            }}
            configureActions={
              agent.agent === 'claude'
                ? [
                    {
                      key: 'wizard',
                      label: t(locale, 'aiConfig.card.configureWizard'),
                      onClick: () => {
                        setSelectedAgentId('claude')
                        setClaudeEntryMode('wizard')
                        setConfigAgentId('claude')
                      },
                    },
                    {
                      key: 'saved',
                      label: t(locale, 'aiConfig.card.savedProviders'),
                      onClick: () => {
                        setSelectedAgentId('claude')
                        setClaudeEntryMode('saved')
                        setConfigAgentId('claude')
                      },
                    },
                  ]
                : undefined
            }
          />
        ))}
      </div>

      {configAgentId === 'claude' && configAgent && (
        <ClaudeConfigModal
          workspaceId={workspaceId}
          locale={locale}
          agent={configAgent}
          snapshot={snapshot.snapshot.claude}
          entryMode={claudeEntryMode}
          installing={installingAgent === 'claude'}
          onInstall={() => void handleInstall('claude')}
          onReload={handleReload}
          onSnapshotUpdate={handleSnapshotUpdate}
          onClose={() => setConfigAgentId(null)}
        />
      )}

      {configAgentId && configAgentId !== 'claude' && lightConfigAgent && (
        <LightAgentConfigModal
          workspaceId={workspaceId}
          locale={locale}
          agent={lightConfigAgent}
          guide={configAgentId === 'codex' ? snapshot.snapshot.codex : snapshot.snapshot.gemini}
          installing={installingAgent === configAgentId}
          onInstall={() => void handleInstall(configAgentId)}
          onReload={handleReload}
          onClose={() => setConfigAgentId(null)}
        />
      )}

      {serviceAgentId && (
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
