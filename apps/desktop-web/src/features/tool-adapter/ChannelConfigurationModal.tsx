import { useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { type AgentRole, type AgentProfile, type ChannelRouteBinding } from '@shell/integration/desktop-api'
import { type ConnectorChannel } from './ChannelManagerPane'
import { AiConfigOverlay } from '../settings/ai-providers/shared/AiConfigOverlay'
import { ChannelBotCard } from './ChannelBotCard'
import { type ChannelBotBindingGroup } from './channel-bot-binding-model'
import { ChannelWizard } from './ChannelWizard'

interface ChannelConfigurationModalProps {
  locale: Locale
  workspaceId: string | null
  channel: ConnectorChannel
  botGroups: ChannelBotBindingGroup[]
  roles: AgentRole[]
  agents: AgentProfile[]
  onClose: () => void
  onEditBinding: (binding: ChannelRouteBinding) => void
  onDeleteBinding: (binding: ChannelRouteBinding) => void
  onToggleBindingEnabled: (binding: ChannelRouteBinding, nextEnabled: boolean) => void
  onHealthCheckBinding: (binding: ChannelRouteBinding) => void
  onWizardSuccess: (message: string) => void
  healthCheckingKey: string | null
  loading: boolean
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
  onToggleBindingEnabled,
  onHealthCheckBinding,
  onWizardSuccess,
  healthCheckingKey,
  loading,
  connectorAccounts,
  telegramWebhook,
  feishuWebhook,
  addedChannels,
}: ChannelConfigurationModalProps) {
  const [wizardOpen, setWizardOpen] = useState(botGroups.length === 0)
  const [editingBinding, setEditingBinding] = useState<ChannelRouteBinding | null>(null)

  const handleEdit = (binding: ChannelRouteBinding) => {
    setEditingBinding(binding)
    setWizardOpen(true)
  }

  const handleWizardClose = () => {
    setWizardOpen(false)
    setEditingBinding(null)
    if (botGroups.length === 0) {
      onClose()
    }
  }

  const handleSuccess = (message: string) => {
    setWizardOpen(false)
    setEditingBinding(null)
    onWizardSuccess(message)
  }

  const title = getChannelDisplayName(locale, channel)

  return (
    <AiConfigOverlay
      title={title}
      subtitle={t(locale, '通道配置管理', 'Channel Configuration')}
      onClose={onClose}
    >
      <div className="provider-workspace">
        {wizardOpen ? (
          <section className="provider-workspace__panel" onClick={(e) => e.stopPropagation()}>
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
            />
          </section>
        ) : (
          <section className="provider-workspace__panel">
            <div className="provider-workspace__toolbar">
              <div>
                <h4>{t(locale, '已配置机器人', 'Configured Bots')}</h4>
                <p>{t(locale, '在这里集中管理当前通道下的机器人与路由绑定。', 'Manage your bots and bindings for this channel here.')}</p>
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
                  onToggleBindingEnabled={onToggleBindingEnabled}
                  onHealthCheckBinding={onHealthCheckBinding}
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
