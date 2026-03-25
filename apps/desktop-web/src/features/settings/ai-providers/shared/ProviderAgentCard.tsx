import type { AiAgentSnapshotCard } from '@shell/integration/desktop-api'
import { AppIcon } from '@shell/ui/icons'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { resolveEnabledEnhancementCount } from './provider-utils'
import { ProviderQuickCommands } from './ProviderQuickCommands'

import './ProviderAgentCard.scss'

interface ProviderAgentCardProps {
  locale: Locale
  agent: AiAgentSnapshotCard
  selected: boolean
  statusLoading: boolean
  installingCli: boolean
  uninstallingCli: boolean
  onSelect: () => void
  onInstall: () => void
  onUninstall: () => void
  onOpenEnhancements: () => void
  onConfigure: () => void
  enhancementDisabled?: boolean
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
  statusLoading,
  installingCli,
  uninstallingCli,
  onSelect,
  onInstall,
  onUninstall,
  onOpenEnhancements,
  onConfigure,
  enhancementDisabled = false,
  configureActions,
}: ProviderAgentCardProps) {
  const installCliDisabled = statusLoading || installingCli
  const uninstallCliDisabled = statusLoading || uninstallingCli
  const isEnhancementDisabled = statusLoading || !agent.installStatus.installed || enhancementDisabled
  const tone = statusLoading ? 'muted' : resolveStatusTone(agent)
  const label = statusLoading
    ? t(locale, '正在检查本机环境', 'Checking local environment')
    : resolveStatusLabel(locale, agent)
  const enabledEnhancementCount = resolveEnabledEnhancementCount(agent)
  const uninstallTitle =
    !agent.installStatus.uninstallAvailable && agent.installStatus.issues.length > 0
      ? agent.installStatus.issues[0]
      : undefined
  const effectiveConfigureActions =
    configureActions && configureActions.length > 0
      ? configureActions
        : [
          {
            key: 'configure',
            label: t(locale, '模型供应商', 'Model Providers'),
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
          {statusLoading ? (
            <div className="meta-item is-loading">
              <AppIcon name="activity" width={12} height={12} />
              <span>{t(locale, '正在检查 CLI 与本地配置', 'Inspecting CLI and local configuration')}</span>
            </div>
          ) : agent.installStatus.installed ? (
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
          {!statusLoading && agent.installStatus.detectedBy.length > 0 && (
            <div className="meta-item">
              <AppIcon name="sparkles" width={12} height={12} />
              <span>{agent.installStatus.detectedBy.join(', ')}</span>
            </div>
          )}
          {statusLoading ? (
            <div className="meta-item is-loading">
              <AppIcon name="clock" width={12} height={12} />
              <span>{t(locale, '增强服务状态稍后补齐', 'Enhancement status will be updated shortly')}</span>
            </div>
          ) : (
            <div className={`meta-item ${enabledEnhancementCount > 0 ? '' : 'warn'}`}>
              <AppIcon name="sparkles" width={12} height={12} />
              <span>
                {enabledEnhancementCount > 0
                  ? t(locale, 'aiConfig.card.enhancementEnabled', { count: String(enabledEnhancementCount) })
                  : t(locale, 'aiConfig.card.enhancementEmpty')}
              </span>
            </div>
          )}
        </div>
      </div>

      {(agent.agent === 'claude' || agent.agent === 'codex' || agent.agent === 'gemini') && (
        <div className="ai-provider-card__quick-commands">
          <ProviderQuickCommands locale={locale} providerId={agent.agent} />
        </div>
      )}

      <div className="ai-provider-card__actions">
        {!agent.installStatus.installed ? (
          <button
            className="action-button primary"
            onClick={(e) => {
              e.stopPropagation()
              onInstall()
            }}
            disabled={installCliDisabled}
          >
            <AppIcon name="cloud-download" width={14} height={14} />
            {installingCli ? t(locale, 'aiConfig.card.installing') : t(locale, 'aiConfig.card.installCli')}
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
            <button
              className={`action-button secondary is-icon-only ${effectiveConfigureActions.length > 1 ? 'is-subaction' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onUninstall()
              }}
              disabled={uninstallCliDisabled}
              title={uninstallTitle}
              aria-label={uninstallingCli ? t(locale, 'aiConfig.card.uninstalling') : t(locale, 'aiConfig.card.uninstallCli')}
            >
              <AppIcon name={uninstallingCli ? 'activity' : 'trash'} width={14} height={14} />
              <span className="vb-sr-only">
                {uninstallingCli ? t(locale, 'aiConfig.card.uninstalling') : t(locale, 'aiConfig.card.uninstallCli')}
              </span>
            </button>
          </div>
        )}
        <button
          className="action-button secondary"
          onClick={(e) => {
            e.stopPropagation()
            if (!isEnhancementDisabled) {
              onOpenEnhancements()
            }
          }}
          disabled={isEnhancementDisabled}
        >
          <AppIcon name="sparkles" width={14} height={14} />
          {t(locale, 'aiConfig.card.enhancementEntry')}
        </button>
      </div>
    </article>
  )
}
