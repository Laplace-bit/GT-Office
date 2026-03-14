import { useEffect, useState } from 'react'

import { desktopApi, type AiConfigAgent, type AiConfigReadSnapshotResponse } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { ProviderAgentCard } from './shared/ProviderAgentCard'
import { ClaudeConfigModal } from './claude/ClaudeConfigModal'
import { LightAgentConfigModal } from './light-agents/LightAgentConfigModal'

import './AiProvidersSection.scss'

interface AiProvidersSectionProps {
  workspaceId: string
  locale: Locale
}

export function AiProvidersSection({ workspaceId, locale }: AiProvidersSectionProps) {
  const [snapshot, setSnapshot] = useState<AiConfigReadSnapshotResponse | null>(null)
  const [installingAgent, setInstallingAgent] = useState<AiConfigAgent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<AiConfigAgent | null>(null)
  const [configAgentId, setConfigAgentId] = useState<AiConfigAgent | null>(null)

  const handleReload = async () => {
    try {
      const data = await desktopApi.aiConfigReadSnapshot(workspaceId)
      setSnapshot(data)
    } catch (err) {
      console.error('Failed to read AI config snapshot', err)
    }
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

  if (!snapshot) {
    return <div className="ai-providers-loading">{t(locale, '加载中...', 'Loading...')}</div>
  }

  const configAgent = snapshot.snapshot.agents.find((a) => a.agent === configAgentId)

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
            installing={installingAgent === agent.agent}
            onInstall={() => void handleInstall(agent.agent)}
            onConfigure={() => setConfigAgentId(agent.agent)}
          />
        ))}
      </div>

      {configAgentId === 'claude' && configAgent && (
        <ClaudeConfigModal
          workspaceId={workspaceId}
          locale={locale}
          agent={configAgent}
          snapshot={snapshot.snapshot.claude}
          installing={installingAgent === 'claude'}
          onInstall={() => void handleInstall('claude')}
          onReload={handleReload}
          onClose={() => setConfigAgentId(null)}
        />
      )}

      {configAgentId && configAgentId !== 'claude' && configAgent && (
        <LightAgentConfigModal
          workspaceId={workspaceId}
          locale={locale}
          agent={configAgent}
          guide={configAgentId === 'codex' ? snapshot.snapshot.codex : snapshot.snapshot.gemini}
          installing={installingAgent === configAgentId}
          onInstall={() => void handleInstall(configAgentId)}
          onReload={() => void handleReload()}
          onClose={() => setConfigAgentId(null)}
        />
      )}
    </section>
  )
}
