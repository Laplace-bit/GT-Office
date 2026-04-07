import { useMemo } from 'react'

import type { AiAgentSnapshotCard, GtoCliStatus, GtoSkillStatus } from '@shell/integration/desktop-api'
import { t, translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AiConfigOverlay } from './AiConfigOverlay'

import './AgentEnhancementsModal.scss'

interface AgentEnhancementsModalProps {
  locale: Locale
  agent: AiAgentSnapshotCard | null
  gtoCliStatus: GtoCliStatus | null
  gtoSkillStatus: GtoSkillStatus | null
  installingGto: boolean
  uninstallingGto: boolean
  installingSkill: boolean
  uninstallingSkill: boolean
  onInstallGto: () => void
  onUninstallSkill: () => void
  onClose: () => void
}

export function AgentEnhancementsModal({
  locale,
  agent,
  gtoCliStatus,
  gtoSkillStatus,
  installingGto,
  uninstallingGto,
  installingSkill,
  uninstallingSkill,
  onInstallGto,
  onUninstallSkill,
  onClose,
}: AgentEnhancementsModalProps) {
  const pluginInstalled = Boolean(gtoCliStatus?.installed && gtoSkillStatus?.installed)
  const pluginManaged = Boolean(
    gtoCliStatus?.installed &&
      gtoCliStatus.managed &&
      gtoSkillStatus?.installed &&
      gtoSkillStatus.managed,
  )
  const pluginBusy = installingGto || uninstallingGto || installingSkill || uninstallingSkill
  const pluginInstallAvailable = Boolean(gtoCliStatus?.installAvailable && gtoSkillStatus?.installAvailable)
  const pluginUninstallAvailable = Boolean(
    (gtoCliStatus?.installed ? gtoCliStatus.uninstallAvailable : true) &&
      (gtoSkillStatus?.installed ? gtoSkillStatus.uninstallAvailable : true),
  )
  const pluginExternal = gtoCliStatus?.issue === 'GTO_CLI_EXTERNAL_INSTALL' || gtoSkillStatus?.issue === 'GTO_SKILL_EXTERNAL_INSTALL'
  const statusLabel = useMemo(() => {
    if (pluginInstalled) {
      return t(locale, 'aiConfig.services.installedAction')
    }
    return t(locale, 'aiConfig.card.notInstalled')
  }, [locale, pluginInstalled])
  const description = useMemo(() => t(locale, 'aiConfig.services.gtoPluginDesc'), [locale])
  const note = useMemo(
    () =>
      pluginExternal
        ? t(locale, 'aiConfig.services.gtoPluginExternalNote')
        : t(locale, 'aiConfig.services.gtoPluginManageNote'),
    [locale, pluginExternal],
  )
  const actionLabel = useMemo(() => {
    if (pluginManaged) {
      return uninstallingGto || uninstallingSkill
        ? t(locale, 'aiConfig.card.uninstalling')
        : t(locale, 'aiConfig.services.gtoPluginUninstall')
    }
    if (pluginBusy) {
      return t(locale, 'aiConfig.card.installing')
    }
    if (pluginExternal) {
      return t(locale, 'aiConfig.services.gtoPluginTakeover')
    }
    return t(locale, 'aiConfig.services.gtoPluginInstall')
  }, [locale, pluginManaged, uninstallingGto, uninstallingSkill, pluginBusy, pluginExternal])

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
        <div className="agent-enhancements__panel">
          <article className="enhancement-service-card">
            <div className="enhancement-service-card__top">
              <div>
                <div className="enhancement-service-card__title-row">
                  <h4>{t(locale, 'aiConfig.services.gtoPluginTitle')}</h4>
                  <span className={`enhancement-service-card__status ${pluginInstalled ? 'is-installed' : 'is-idle'}`}>
                    {statusLabel}
                  </span>
                </div>
                <p>{description}</p>
              </div>
            </div>
            <div className="enhancement-service-card__footer">
              <div className="service-note">{note}</div>
              <div className="enhancement-service-card__actions">
                {pluginManaged ? (
                  <button
                    type="button"
                    className="nav-btn btn-secondary"
                    disabled={!pluginUninstallAvailable || pluginBusy}
                    onClick={onUninstallSkill}
                  >
                    <AppIcon name={pluginBusy ? 'activity' : 'trash'} width={16} height={16} />
                    {actionLabel}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="nav-btn btn-primary"
                    disabled={!pluginInstallAvailable || pluginBusy}
                    onClick={onInstallGto}
                  >
                    <AppIcon name={pluginBusy ? 'activity' : 'cloud-download'} width={16} height={16} />
                    {actionLabel}
                  </button>
                )}
              </div>
            </div>
          </article>
        </div>
      </div>
    </AiConfigOverlay>
  )
}
