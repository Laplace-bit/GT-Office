import { useEffect, useState } from 'react'

import { desktopApi, type AiConfigAgent, type AiConfigReadSnapshotResponse } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { ClaudeProviderWorkspace } from './claude/ClaudeProviderWorkspace'
import { LightAgentGuideCard } from './light-agents/LightAgentGuideCard'
import { ProviderAgentCard } from './shared/ProviderAgentCard'

import './AiProvidersSection.scss'
import './claude/ClaudeProviderWorkspace.scss'
import './light-agents/LightAgentGuideCard.scss'

interface AiProvidersSectionProps {
  locale: Locale
  workspaceId: string | null
}

type InstallAgentId = 'ClaudeCode' | 'Codex' | 'Gemini'

function mapInstallAgentId(agent: AiConfigAgent): InstallAgentId {
  switch (agent) {
    case 'claude':
      return 'ClaudeCode'
    case 'codex':
      return 'Codex'
    case 'gemini':
      return 'Gemini'
  }
}

export function AiProvidersSection({ locale, workspaceId }: AiProvidersSectionProps) {
  const [snapshot, setSnapshot] = useState<AiConfigReadSnapshotResponse | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<AiConfigAgent>('claude')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installingAgent, setInstallingAgent] = useState<AiConfigAgent | null>(null)

  async function loadSnapshot(activeWorkspaceId: string) {
    setLoading(true)
    setError(null)
    try {
      const nextSnapshot = await desktopApi.aiConfigReadSnapshot(activeWorkspaceId)
      setSnapshot(nextSnapshot)
    } catch (loadError) {
      setError(String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!workspaceId) {
      setSnapshot(null)
      return
    }
    void loadSnapshot(workspaceId)
  }, [workspaceId])

  async function handleInstall(agent: AiConfigAgent) {
    const installAgent = mapInstallAgentId(agent)
    setInstallingAgent(agent)
    setError(null)
    try {
      await desktopApi.installAgent(installAgent)
      if (workspaceId) {
        await loadSnapshot(workspaceId)
      }
    } catch (installError) {
      setError(String(installError))
    } finally {
      setInstallingAgent(null)
    }
  }

  if (!workspaceId) {
    return (
      <section className="ai-providers-shell">
        <div className="ai-providers-empty-state">
          <h3>{t(locale, '先打开工作区，再配置 Agent 供应商', 'Open a workspace before configuring agent providers')}</h3>
          <p>{t(locale, 'AI 配置是工作区作用域能力。打开工作区后，GT Office 才能把 Claude 配置写入 `.gtoffice/config.json` 并在启动终端时自动注入。', 'AI configuration is workspace-scoped. After opening a workspace, GT Office can write Claude settings into `.gtoffice/config.json` and inject them when launching terminals.')}</p>
        </div>
      </section>
    )
  }

  const cards = snapshot?.snapshot.agents ?? []
  const selectedCard = cards.find((card) => card.agent === selectedAgent) ?? cards[0]

  return (
    <section className="ai-providers-shell">
      <header className="ai-providers-shell__hero">
        <div>
          <span className="ai-providers-shell__eyebrow">{t(locale, '一站式 Agent 配置中心', 'One-stop agent configuration hub')}</span>
          <h3>{t(locale, '让任何用户都能把 Agent 用起来', 'Make every agent easy to use')}</h3>
          <p>{t(locale, '先检查安装，再给 Claude 提供完整的供应商、充值和 API Key 引导；Codex 与 Gemini 保持轻量，不重复制造配置成本。', 'Check installation first, then offer Claude full provider, billing, and API key guidance. Keep Codex and Gemini lightweight so users do not pay a second configuration tax.')}</p>
        </div>
        <div className="ai-provider-surface-block ai-provider-surface-block--compact">
          <span className="ai-provider-surface-block__label">{t(locale, '作用范围', 'Scope')}</span>
          <strong>{t(locale, '当前工作区', 'Current workspace')}</strong>
          <small>{workspaceId}</small>
        </div>
      </header>

      {error ? <p className="ai-provider-feedback ai-provider-feedback--error">{error}</p> : null}

      <div className="ai-providers-agent-grid">
        {cards.map((card) => (
          <ProviderAgentCard
            key={card.agent}
            locale={locale}
            agent={card}
            selected={selectedCard?.agent === card.agent}
            installing={installingAgent === card.agent}
            onSelect={() => setSelectedAgent(card.agent)}
            onInstall={() => void handleInstall(card.agent)}
          />
        ))}
      </div>

      {loading && !snapshot ? (
        <div className="ai-providers-empty-state">
          <h3>{t(locale, '正在读取 Agent 配置中心...', 'Loading agent configuration hub...')}</h3>
        </div>
      ) : null}

      {snapshot && selectedCard?.agent === 'claude' ? (
        <ClaudeProviderWorkspace
          locale={locale}
          workspaceId={workspaceId}
          agent={selectedCard}
          snapshot={snapshot.snapshot.claude}
          installing={installingAgent === 'claude'}
          onInstall={() => void handleInstall('claude')}
          onReload={() => loadSnapshot(workspaceId)}
        />
      ) : null}

      {snapshot && selectedCard?.agent === 'codex' ? (
        <LightAgentGuideCard
          locale={locale}
          agent={selectedCard}
          guide={snapshot.snapshot.codex}
          installing={installingAgent === 'codex'}
          onInstall={() => void handleInstall('codex')}
        />
      ) : null}

      {snapshot && selectedCard?.agent === 'gemini' ? (
        <LightAgentGuideCard
          locale={locale}
          agent={selectedCard}
          guide={snapshot.snapshot.gemini}
          installing={installingAgent === 'gemini'}
          onInstall={() => void handleInstall('gemini')}
        />
      ) : null}
    </section>
  )
}
