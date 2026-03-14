import { useEffect, useState } from 'react'

import { desktopApi, type AiConfigAgent, type AiConfigReadSnapshotResponse } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { ClaudeProviderWorkspace } from './claude/ClaudeProviderWorkspace'
import { LightAgentProviderWorkspace } from './light-agents/LightAgentProviderWorkspace'
import { ProviderAgentCard } from './shared/ProviderAgentCard'

import './AiProvidersSection.scss'
import './claude/ClaudeProviderWorkspace.scss'

interface AiProvidersSectionProps {
  workspaceId: string
  locale: Locale
}

export function AiProvidersSection({ workspaceId, locale }: AiProvidersSectionProps) {
  const [snapshot, setSnapshot] = useState<AiConfigReadSnapshotResponse | null>(null)
  const [installingAgent, setInstallingAgent] = useState<AiConfigAgent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<AiConfigAgent | null>(null)

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

  const selectedCard = snapshot.snapshot.agents.find((a) => a.agent === selectedAgentId)

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
          />
        ))}
      </div>

      <div className="ai-providers-divider" />

      {selectedCard?.agent === 'claude' ? (
        <ClaudeProviderWorkspace
          workspaceId={workspaceId}
          locale={locale}
          agent={selectedCard}
          snapshot={snapshot.snapshot.claude}
          installing={installingAgent === 'claude'}
          onInstall={() => void handleInstall('claude')}
          onReload={handleReload}
        />
      ) : selectedCard ? (
        <LightAgentProviderWorkspace
          workspaceId={workspaceId}
          locale={locale}
          agent={selectedCard}
          guide={selectedCard.agent === 'codex' ? snapshot.snapshot.codex : snapshot.snapshot.gemini}
          installing={installingAgent === selectedCard.agent}
          onInstall={() => void handleInstall(selectedCard.agent as any)}
          onReload={() => void handleReload()}
        />
      ) : null}
    </section>
  )
}
