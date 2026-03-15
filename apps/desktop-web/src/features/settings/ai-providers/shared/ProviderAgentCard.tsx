import type { AiAgentSnapshotCard } from '@shell/integration/desktop-api'
import { AppIcon } from '@shell/ui/icons'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'

import './ProviderAgentCard.scss'

interface ProviderAgentCardProps {
  locale: Locale
  agent: AiAgentSnapshotCard
  selected: boolean
  installing: boolean
  onSelect: () => void
  onInstall: () => void
  onConfigure: () => void
  configureActions?: Array<{
    key: string
    label: string
    onClick: () => void
  }>
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
    return t(locale, 'aiConfig.card.ready')
  }
  if (!agent.installStatus.installed) {
    return t(locale, 'aiConfig.card.notInstalled')
  }
  return t(locale, 'aiConfig.card.needsSetup')
}

export function ProviderAgentCard({
  locale,
  agent,
  selected,
  installing,
  onSelect,
  onInstall,
  onConfigure,
  configureActions,
}: ProviderAgentCardProps) {
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)
  const tone = resolveStatusTone(agent)
  const label = resolveStatusLabel(locale, agent)
  const effectiveConfigureActions =
    configureActions && configureActions.length > 0
      ? configureActions
      : [
          {
            key: 'configure',
            label: t(locale, 'aiConfig.card.configure'),
            onClick: onConfigure,
          },
        ]

  const logoSrc = {
    claude: '/assets/logos/claude.webp',
    codex: '/assets/logos/openai.webp',
    gemini: '/assets/logos/gemini.webp',
  }[agent.agent]

  return (
    <article
      className={`ai-provider-card ${selected ? 'is-active' : ''} is-${tone}`}
      onClick={onSelect}
    >
      <div className="ai-provider-card__header">
        <div className="ai-provider-card__icon">
          <img src={logoSrc} alt={agent.agent} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div className="ai-provider-card__title">
          <h4>{translateMaybeKey(locale, agent.title)}</h4>
          <span className={`status-dot tone-${tone}`} title={label} />
        </div>
      </div>

      <div className="ai-provider-card__body">
        <p>{translateMaybeKey(locale, agent.subtitle)}</p>
        <div className="ai-provider-card__meta">
          {agent.installStatus.installed ? (
            <div className="meta-item">
              <AppIcon name="terminal" width={12} height={12} />
              <span>{agent.installStatus.executable || 'Installed'}</span>
            </div>
          ) : (
            <div className="meta-item warn">
              <AppIcon name="info" width={12} height={12} />
              <span>{t(locale, 'aiConfig.card.noExecutable')}</span>
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
            {installing ? t(locale, 'aiConfig.card.installing') : t(locale, 'aiConfig.card.install')}
          </button>
        ) : (
          <div className={`ai-provider-card__action-group ${effectiveConfigureActions.length > 1 ? 'is-multi' : ''}`}>
            {effectiveConfigureActions.map((action) => (
              <button
                key={action.key}
                className={`action-button secondary ${effectiveConfigureActions.length > 1 ? 'is-subaction' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  action.onClick()
                }}
              >
                {effectiveConfigureActions.length === 1 ? (
                  <>
                    <AppIcon name="settings" width={14} height={14} />
                    {action.label}
                  </>
                ) : (
                  action.label
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
