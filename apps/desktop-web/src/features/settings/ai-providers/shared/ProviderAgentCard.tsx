import type { AiAgentSnapshotCard } from '@shell/integration/desktop-api'
import { AppIcon } from '@shell/ui/icons'
import { t, type Locale } from '@shell/i18n/ui-locale'

import './ProviderAgentCard.scss'

interface ProviderAgentCardProps {
  locale: Locale
  agent: AiAgentSnapshotCard
  selected: boolean
  installing: boolean
  onSelect: () => void
  onInstall: () => void
  onConfigure: () => void
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
  return t(locale, '待配置', 'Needs setup')
}

export function ProviderAgentCard({
  locale,
  agent,
  selected,
  installing,
  onSelect,
  onInstall,
  onConfigure,
}: ProviderAgentCardProps) {
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)
  const tone = resolveStatusTone(agent)
  const label = resolveStatusLabel(locale, agent)

  return (
    <article
      className={`ai-provider-card ${selected ? 'is-active' : ''} is-${tone}`}
      onClick={onSelect}
    >
      <div className="ai-provider-card__header">
        <div className="ai-provider-card__icon">
          {agent.agent === 'claude' ? '󰚩' : '󰚩'}
        </div>
        <div className="ai-provider-card__title">
          <h4>{agent.title}</h4>
          <span className={`status-dot tone-${tone}`} title={label} />
        </div>
      </div>

      <div className="ai-provider-card__body">
        <p>{agent.subtitle}</p>
        <div className="ai-provider-card__meta">
          {agent.installStatus.installed ? (
            <div className="meta-item">
              <AppIcon name="terminal" width={12} height={12} />
              <span>{agent.installStatus.executable || 'Installed'}</span>
            </div>
          ) : (
            <div className="meta-item warn">
              <AppIcon name="info" width={12} height={12} />
              <span>{t(locale, '未检测到可执行文件', 'Not installed')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="ai-provider-card__actions">
        {!agent.installStatus.installed ? (
          <button
            className="action-button primary"
            onClick={(e) => { e.stopPropagation(); onInstall(); }}
            disabled={installDisabled}
          >
            {installing ? t(locale, '安装中...', 'Installing...') : t(locale, '立即安装', 'Install')}
          </button>
        ) : (
          <button
            className="action-button secondary"
            onClick={(e) => { e.stopPropagation(); onConfigure(); }}
          >
            <AppIcon name="settings" width={14} height={14} />
            {t(locale, '配置', 'Configure')}
          </button>
        )}
      </div>
    </article>
  )
}
