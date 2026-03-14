import type { AiAgentSnapshotCard } from '@shell/integration/desktop-api'
import { AppIcon } from '@shell/ui/icons'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { StatusPill } from './StatusPill'

interface ProviderAgentCardProps {
  locale: Locale
  agent: AiAgentSnapshotCard
  selected: boolean
  installing: boolean
  onSelect: () => void
  onInstall: () => void
}

function resolveStatusTone(agent: AiAgentSnapshotCard): 'success' | 'warning' | 'muted' {
  if (agent.installStatus.installed && agent.configStatus === 'configured') {
    return 'success'
  }
  if (!agent.installStatus.installed) {
    return 'warning'
  }
  return 'muted'
}

function resolveStatusLabel(locale: Locale, agent: AiAgentSnapshotCard): string {
  if (agent.installStatus.installed && agent.configStatus === 'configured') {
    return t(locale, '已就绪', 'Ready')
  }
  if (!agent.installStatus.installed) {
    return t(locale, '未安装', 'Not installed')
  }
  if (agent.configStatus === 'guidance_only') {
    return t(locale, '轻量配置', 'Light setup')
  }
  return t(locale, '待配置', 'Needs setup')
}

export function ProviderAgentCard({
  locale,
  agent,
  selected,
  installing,
  onSelect,
  onInstall,
}: ProviderAgentCardProps) {
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)
  const installLabel = installing
    ? t(locale, '安装中...', 'Installing...')
    : agent.installStatus.requiresNode && !agent.installStatus.nodeReady
      ? t(locale, '先安装 Node.js', 'Install Node.js first')
      : t(locale, '立即安装', 'Install now')

  return (
    <article
      className={`ai-provider-agent-card ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="ai-provider-agent-card__row">
        <div>
          <h4>{agent.title}</h4>
          <p>{agent.subtitle}</p>
        </div>
        <StatusPill tone={resolveStatusTone(agent)} label={resolveStatusLabel(locale, agent)} />
      </div>

      <div className="ai-provider-agent-card__meta">
        <span>
          <AppIcon name="terminal" aria-hidden="true" />
          {agent.installStatus.installed
            ? agent.installStatus.executable ?? t(locale, '已检测到可执行文件', 'Executable detected')
            : t(locale, '尚未检测到本机命令', 'No local executable detected')}
        </span>
        {agent.activeSummary ? (
          <span>
            <AppIcon name="sparkles" aria-hidden="true" />
            {agent.activeSummary}
          </span>
        ) : null}
      </div>

      {!agent.installStatus.installed ? (
        <button
          type="button"
          className="ai-provider-secondary-button"
          onClick={(event) => {
            event.stopPropagation()
            onInstall()
          }}
          disabled={installDisabled}
        >
          {installLabel}
        </button>
      ) : null}
    </article>
  )
}
