import { useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { type AgentRole, type AgentProfile, type ChannelRouteBinding } from '@shell/integration/desktop-api'
import { type ConnectorChannel } from './ChannelManagerPane'
import { AiConfigOverlay } from '../settings/ai-providers/shared/AiConfigOverlay'
import { ChannelBotCard } from './ChannelBotCard'
import { type ChannelBotBindingGroup, isConfiguredChannelBotGroup } from './channel-bot-binding-model'
import { ChannelWizard } from './ChannelWizard'

interface ChannelConfigurationModalProps {
  locale: Locale
  workspaceId: string | null
  channel: ConnectorChannel
  botGroups: ChannelBotBindingGroup[]
  roles: AgentRole[]
  agents: AgentProfile[]
  onClose: () => void
  onDeleteBinding: (binding: ChannelRouteBinding) => void
  onDeleteGroup: (group: ChannelBotBindingGroup) => void
  onToggleBindingEnabled: (binding: ChannelRouteBinding, nextEnabled: boolean) => void
  onHealthCheckGroup: (group: ChannelBotBindingGroup) => void
  onWizardSuccess: (message: string) => void
  healthCheckingKey: string | null
  loading: boolean
  statusMessage?: string | null
  errorMessage?: string | null
  connectorAccounts: any[]
  telegramWebhook: string
  feishuWebhook: string
  addedChannels: ConnectorChannel[]
}

const getChannelDisplayName = (locale: Locale, channel: ConnectorChannel) => {
  switch (channel) {
    case 'wechat':
      return t(locale, '微信', 'WeChat')
    case 'feishu':
      return t(locale, '飞书', 'Feishu')
    case 'telegram':
      return 'Telegram'
    default:
      return channel
  }
}

export function ChannelConfigurationModal({
  locale,
  workspaceId,
  channel,
  botGroups,
  roles,
  agents,
  onClose,
  onDeleteBinding,
  onDeleteGroup,
  onToggleBindingEnabled,
  onHealthCheckGroup,
  onWizardSuccess,
  healthCheckingKey,
  loading,
  statusMessage,
  errorMessage,
  connectorAccounts,
  telegramWebhook,
  feishuWebhook,
  addedChannels,
}: ChannelConfigurationModalProps) {
  const hasConfiguredGroups = botGroups.some(isConfiguredChannelBotGroup)
  const [wizardOpen, setWizardOpen] = useState(!hasConfiguredGroups)
  const [editingBinding, setEditingBinding] = useState<ChannelRouteBinding | null>(null)

  const handleEdit = (binding: ChannelRouteBinding) => {
    setEditingBinding(binding)
    setWizardOpen(true)
  }

  const handleWizardClose = () => {
    setWizardOpen(false)
    setEditingBinding(null)
    if (!hasConfiguredGroups) {
      onClose()
    }
  }

  const handleSuccess = (message: string) => {
    setWizardOpen(false)
    setEditingBinding(null)
    onWizardSuccess(message)
  }

  const title = getChannelDisplayName(locale, channel)

  const wizardSubtitle = editingBinding
    ? t(locale, '编辑通道绑定', 'Edit channel binding')
    : t(locale, '添加通道连接', 'Add channel connection')

  return (
    <AiConfigOverlay
      title={title}
      subtitle={wizardOpen ? wizardSubtitle : t(locale, '通道配置管理', 'Channel Configuration')}
      onClose={onClose}
    >
      <div className={`provider-workspace ${wizardOpen ? 'provider-workspace--channel-wizard' : ''}`}>
        {!wizardOpen && errorMessage ? <div className="provider-workspace__feedback is-error">{errorMessage}</div> : null}
        {!wizardOpen && statusMessage ? <div className="provider-workspace__feedback is-success">{statusMessage}</div> : null}
        {wizardOpen ? (
          <ChannelWizard
            locale={locale}
            workspaceId={workspaceId}
            onClose={handleWizardClose}
            onSuccess={handleSuccess}
            editingBinding={editingBinding}
            roles={roles}
            agents={agents}
            connectorAccounts={connectorAccounts}
            addedChannels={addedChannels}
            telegramWebhook={telegramWebhook}
            feishuWebhook={feishuWebhook}
            initialChannel={channel}
            embedded
          />
        ) : (
          <section className="provider-workspace__panel">
            <div className="provider-workspace__toolbar">
              <div>
                <h4>{t(locale, '已绑定 Agent', 'Bound Agents')}</h4>
              </div>
              <div className="provider-workspace__toolbar-actions">
                <button
                  type="button"
                  className="nav-btn btn-primary provider-workspace__primary-action"
                  onClick={() => setWizardOpen(true)}
                >
                  <AppIcon name="plus" width={15} height={15} />
                  {t(locale, '新增机器人', 'Add Bot')}
                </button>
              </div>
            </div>

            <div className="channel-bot-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {botGroups.map((group) => (
                <ChannelBotCard
                  key={`${group.channel}:${group.accountId}`}
                  group={group}
                  locale={locale}
                  roles={roles}
                  agents={agents}
                  onEditBinding={handleEdit}
                  onDeleteBinding={onDeleteBinding}
                  onDeleteGroup={onDeleteGroup}
                  onToggleBindingEnabled={onToggleBindingEnabled}
                  onHealthCheckGroup={onHealthCheckGroup}
                  healthCheckingKey={healthCheckingKey}
                  loading={loading}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </AiConfigOverlay>
  )
}
