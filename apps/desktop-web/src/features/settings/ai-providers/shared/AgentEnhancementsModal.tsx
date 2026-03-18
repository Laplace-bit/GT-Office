import { useMemo, useState } from 'react'

import type { AiAgentSnapshotCard } from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from './AiConfigOverlay'
import { resolveMcpEnhancementState } from './provider-utils'

import './AgentEnhancementsModal.scss'

type EnhancementTab = 'mcp' | 'skills'

interface AgentEnhancementsModalProps {
  locale: Locale
  agent: AiAgentSnapshotCard | null
  installingMcp: boolean
  onInstallMcp: () => void
  onClose: () => void
}

export function AgentEnhancementsModal({
  locale,
  agent,
  installingMcp,
  onInstallMcp,
  onClose,
}: AgentEnhancementsModalProps) {
  const [tab, setTab] = useState<EnhancementTab>('mcp')

  const mcpState = agent ? resolveMcpEnhancementState(agent) : 'not_installed'
  const serviceStatusTone = mcpState === 'installed' ? 'is-installed' : 'is-idle'
  const serviceStatusLabel = useMemo(() => {
    if (mcpState === 'installed') {
      return t(locale, 'aiConfig.services.mcpStateInstalled')
    }
    return t(locale, 'aiConfig.services.mcpStateNotInstalled')
  }, [locale, mcpState])

  if (!agent) {
    return null
  }

  return (
    <AiConfigOverlay
      title={t(locale, 'aiConfig.services.title')}
      subtitle={translateMaybeKey(locale, agent.title)}
      onClose={onClose}
    >
      <div className="agent-enhancements">
        <div className="agent-enhancements__tabs" role="tablist" aria-label={t(locale, 'aiConfig.services.title')}>
          {([
            ['mcp', 'aiConfig.services.tabMcp'],
            ['skills', 'aiConfig.services.tabSkills'],
          ] as const).map(([key, labelKey]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`agent-enhancements__tab ${tab === key ? 'is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {t(locale, labelKey)}
            </button>
          ))}
        </div>

        {tab === 'mcp' ? (
          <div className="agent-enhancements__panel">
            <article className="enhancement-service-card">
              <div className="enhancement-service-card__top">
                <div>
                  <div className="enhancement-service-card__title-row">
                    <h4>{t(locale, 'aiConfig.services.mcpCardTitle')}</h4>
                    <span className={`enhancement-service-card__status ${serviceStatusTone}`}>
                      {serviceStatusLabel}
                    </span>
                  </div>
                  <p>{t(locale, 'aiConfig.services.mcpCardDesc')}</p>
                </div>
              </div>

              <div className="enhancement-service-card__details">
                <div className="detail-item">
                  <span>{t(locale, 'aiConfig.services.scope')}</span>
                  <strong>{t(locale, 'aiConfig.services.scopePerAgent')}</strong>
                </div>
                <div className="detail-item">
                  <span>{t(locale, 'aiConfig.services.prerequisite')}</span>
                  <strong>
                    {agent.installStatus.installed
                      ? t(locale, 'aiConfig.services.prerequisiteReady')
                      : t(locale, 'aiConfig.services.prerequisiteCli')}
                  </strong>
                </div>
              </div>

              <div className="enhancement-service-card__footer">
                <div className="service-note">
                  {t(locale, 'aiConfig.services.mcpNote')}
                </div>
                {mcpState === 'installed' ? (
                  <button type="button" className="nav-btn btn-secondary" disabled>
                    <AppIcon name="check" width={16} height={16} />
                    {t(locale, 'aiConfig.services.installedAction')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="nav-btn btn-primary"
                    disabled={installingMcp}
                    onClick={onInstallMcp}
                  >
                    <AppIcon name="cloud-download" width={16} height={16} />
                    {installingMcp
                      ? t(locale, 'aiConfig.card.installing')
                      : t(locale, 'aiConfig.services.installMcpAction')}
                  </button>
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="agent-enhancements__panel">
            <article className="enhancement-empty-state">
              <div className="enhancement-empty-state__icon">
                <AppIcon name="sparkles" width={18} height={18} />
              </div>
              <h4>{t(locale, 'aiConfig.services.skillsTitle')}</h4>
              <p>{t(locale, 'aiConfig.services.skillsDesc')}</p>
            </article>
          </div>
        )}
      </div>
    </AiConfigOverlay>
  )
}
