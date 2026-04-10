import { useState } from 'react'
import { createPortal } from 'react-dom'
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

function translateInstallIssue(locale: Locale, issue: string, agentKind: string): string {
  if (issue.includes('npm is not available') || issue.includes('npm 不可用')) {
    return t(locale, 'aiConfig.card.envNpmMissing')
  }
  if (issue.includes('Node.js runtime not found') || issue.includes('Node.js 运行时')) {
    return t(locale, 'aiConfig.card.envNodeMissing')
  }
  if (issue.includes('fresh shell still may not resolve') || issue.includes('新终端可能无法')) {
    return t(locale, 'aiConfig.card.issueShellNotReady')
  }
  if (issue.includes('uninstall source could not be identified') || issue.includes('卸载来源无法自动识别')) {
    const name = agentKind === 'codex' ? 'Codex CLI' : agentKind === 'gemini' ? 'Gemini CLI' : agentKind
    return t(locale, 'aiConfig.card.issueUninstallUnknown', { name })
  }
  return issue
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
  const [commandsOpen, setCommandsOpen] = useState(false)

  const installCliDisabled = statusLoading || installingCli || (!agent.installStatus.installed && !agent.installStatus.installAvailable)
  const uninstallCliDisabled = statusLoading || uninstallingCli || !agent.installStatus.uninstallAvailable
  const isEnhancementDisabled = statusLoading || !agent.installStatus.installed || enhancementDisabled
  const tone = statusLoading ? 'muted' : resolveStatusTone(agent)
  const label = statusLoading
    ? t(locale, '正在检查本机环境', 'Checking local environment')
    : resolveStatusLabel(locale, agent)
  const enabledEnhancementCount = resolveEnabledEnhancementCount(agent)
  const hasEnvIssues = !statusLoading && !agent.installStatus.installed && agent.installStatus.requiresNode && (!agent.installStatus.nodeReady || !agent.installStatus.npmReady)
  const showManualUninstall = !statusLoading && agent.installStatus.installed && !agent.installStatus.uninstallAvailable

  const hasQuickCommands = agent.agent === 'claude' || agent.agent === 'codex' || agent.agent === 'gemini'

  const logoSrc = {
    claude: '/assets/logos/claude.webp',
    codex: '/assets/logos/openai.webp',
    gemini: '/assets/logos/gemini.webp',
  }[agent.agent]

  const primaryAction = !agent.installStatus.installed ? (
    <button
      className="pac-btn pac-btn--primary"
      onClick={(e) => {
        e.stopPropagation()
        onInstall()
      }}
      disabled={installCliDisabled}
      title={hasEnvIssues ? t(locale, 'aiConfig.card.envIssue') : undefined}
    >
      <AppIcon name="cloud-download" width={13} height={13} />
      {installingCli ? t(locale, 'aiConfig.card.installing') : t(locale, 'aiConfig.card.installCli')}
    </button>
  ) : (
    <button
      className="pac-btn pac-btn--secondary"
      onClick={(e) => {
        e.stopPropagation()
        onConfigure()
      }}
    >
      <AppIcon name="settings" width={13} height={13} />
      {t(locale, '配置', 'Configure')}
    </button>
  )

  const extraConfigureActions = configureActions && configureActions.length > 1
    ? configureActions.filter((_, i) => i > 0)
    : []

  return (
    <>
      <article
        className={`ai-provider-card ${selected ? 'is-active' : ''} is-${tone}`}
        onClick={onSelect}
      >
        {/* Header */}
        <div className="ai-provider-card__header">
          <div className="ai-provider-card__icon">
            <img src={logoSrc} alt={agent.agent} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div className="ai-provider-card__title">
            <h4>{translateMaybeKey(locale, agent.title)}</h4>
            <span className={`status-dot tone-${tone}`} title={label} />
          </div>
        </div>

        {/* Status */}
        <div className="ai-provider-card__status">
          {statusLoading ? (
            <div className="pac-status-chip is-loading">
              <AppIcon name="activity" width={11} height={11} />
              <span>{t(locale, '正在检查', 'Checking...')}</span>
            </div>
          ) : agent.installStatus.installed ? (
            <div className="pac-status-chip is-success">
              <AppIcon name="check" width={11} height={11} />
              <span>{agent.installStatus.executable
                ? agent.installStatus.executable.replace(/.*\//,'').replace(/.*\\/,'')
                : t(locale, 'aiConfig.card.installedState')
              }</span>
            </div>
          ) : (
            <div className="pac-status-chip is-warning">
              <AppIcon name="cloud-download" width={11} height={11} />
              <span>{t(locale, 'aiConfig.card.notInstalledState')}</span>
            </div>
          )}
          {!statusLoading && enabledEnhancementCount > 0 && (
            <div className="pac-status-chip is-enhanced">
              <AppIcon name="sparkles" width={11} height={11} />
              <span>{t(locale, 'aiConfig.card.enhancementEnabled', { count: String(enabledEnhancementCount) })}</span>
            </div>
          )}
        </div>

        {/* Env issues banner */}
        {hasEnvIssues && (
          <div className="ai-provider-card__env-issues">
            {!agent.installStatus.nodeReady && (
              <div className="env-issue-item">
                <AppIcon name="info" width={12} height={12} />
                <span>{t(locale, 'aiConfig.card.envNodeMissing')}</span>
              </div>
            )}
            {agent.installStatus.nodeReady && !agent.installStatus.npmReady && (
              <div className="env-issue-item">
                <AppIcon name="info" width={12} height={12} />
                <span>{t(locale, 'aiConfig.card.envNpmMissing')}</span>
              </div>
            )}
          </div>
        )}
        {showManualUninstall && agent.installStatus.issues.length > 0 && (
          <div className="ai-provider-card__env-issues is-info">
            <div className="env-issue-item">
              <AppIcon name="info" width={12} height={12} />
              <span>{translateInstallIssue(locale, agent.installStatus.issues[0], agent.agent)}</span>
            </div>
          </div>
        )}

        {/* Actions row */}
        <div className="ai-provider-card__actions">
          <div className="pac-primary-actions">
            {primaryAction}
            {extraConfigureActions.map((action) => (
              <button
                key={action.key}
                className="pac-btn pac-btn--secondary"
                onClick={(e) => { e.stopPropagation(); action.onClick() }}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="pac-icon-actions">
            {hasQuickCommands && (
              <button
                className="pac-icon-btn"
                title={t(locale, '快捷命令', 'Quick Commands')}
                aria-label={t(locale, '快捷命令', 'Quick Commands')}
                onClick={(e) => { e.stopPropagation(); setCommandsOpen(true) }}
              >
                <AppIcon name="bolt" width={14} height={14} />
              </button>
            )}
            <button
              className="pac-icon-btn"
              title={t(locale, 'aiConfig.card.enhancementEntry')}
              aria-label={t(locale, 'aiConfig.card.enhancementEntry')}
              disabled={isEnhancementDisabled}
              onClick={(e) => {
                e.stopPropagation()
                if (!isEnhancementDisabled) onOpenEnhancements()
              }}
            >
              <AppIcon name="sparkles" width={14} height={14} />
            </button>
            {agent.installStatus.installed && (
              <button
                className={`pac-icon-btn is-danger ${uninstallCliDisabled ? 'is-disabled' : ''}`}
                title={showManualUninstall
                  ? t(locale, 'aiConfig.card.manualUninstallHint')
                  : t(locale, 'aiConfig.card.uninstallCli')}
                aria-label={showManualUninstall
                  ? t(locale, 'aiConfig.card.manualUninstall')
                  : uninstallingCli ? t(locale, 'aiConfig.card.uninstalling') : t(locale, 'aiConfig.card.uninstallCli')}
                disabled={uninstallCliDisabled}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!showManualUninstall) onUninstall()
                }}
              >
                <AppIcon name={uninstallingCli ? 'activity' : 'trash'} width={14} height={14} />
              </button>
            )}
          </div>
        </div>
      </article>

      {/* Quick Commands Modal — portaled to body */}
      {commandsOpen && hasQuickCommands && createPortal(
        <div
          className="pac-commands-overlay"
          onClick={() => setCommandsOpen(false)}
        >
          <div
            className="pac-commands-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, '快捷命令', 'Quick Commands')}
          >
            <div className="pac-commands-drawer__header">
              <div className="pac-commands-drawer__title">
                <div className="pac-commands-drawer__agent-icon">
                  <img src={logoSrc} alt={agent.agent} width="20" height="20" style={{ objectFit: 'contain' }} />
                </div>
                <div>
                  <strong>{translateMaybeKey(locale, agent.title)}</strong>
                  <span>{t(locale, '快捷命令', 'Quick Commands')}</span>
                </div>
              </div>
              <button
                type="button"
                className="pac-commands-drawer__close"
                onClick={() => setCommandsOpen(false)}
                aria-label={t(locale, 'aiConfig.progress.close')}
              >
                <AppIcon name="close" width={16} height={16} />
              </button>
            </div>
            <div className="pac-commands-drawer__body">
              <ProviderQuickCommands locale={locale} providerId={agent.agent} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
