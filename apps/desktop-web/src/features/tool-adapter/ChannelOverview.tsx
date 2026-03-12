import { t, type Locale } from '@shell/i18n/ui-locale'
import { ChannelBotCard } from './ChannelBotCard'
import { buildChannelBotBindingGroups } from './channel-bot-binding-model'
import { type AgentRole, type AgentProfile, type ChannelRouteBinding } from '@shell/integration/desktop-api'
import { AppIcon } from '@shell/ui/icons'

interface ChannelOverviewProps {
  locale: Locale
  variant?: 'embedded' | 'studio'
  runtimeRunning: boolean
  onAddChannel: () => void
  channelBotGroups: ReturnType<typeof buildChannelBotBindingGroups>
  roles: AgentRole[]
  agents: AgentProfile[]
  onEditBinding: (binding: ChannelRouteBinding) => void
  onDeleteBinding: (binding: ChannelRouteBinding) => void
  onHealthCheckBinding: (binding: ChannelRouteBinding) => void
  healthCheckingKey: string | null
  loading: boolean
}

export function ChannelOverview({
  locale,
  variant = 'embedded',
  runtimeRunning,
  onAddChannel,
  channelBotGroups,
  roles,
  agents,
  onEditBinding,
  onDeleteBinding,
  onHealthCheckBinding,
  healthCheckingKey,
  loading
}: ChannelOverviewProps) {
  return (
    <>
      <div className={`channel-overview-top ${variant === 'studio' ? 'studio' : ''}`}>
        <div className="channel-overview-status">
          <h4>
            {variant === 'studio'
              ? t(locale, '机器人接入与健康状态', 'Bot onboarding and health status')
              : t(locale, '通道连接管理', 'Channel Connection Management')}
          </h4>
          <p>
            {variant === 'studio'
              ? t(locale, '在这里维护 Telegram / 飞书账号、绑定路由，并集中查看健康检查结果。', 'Manage Telegram / Feishu accounts, bind routes, and review connector health from one place.')
              : t(locale, '管理您的 Telegram 和 Feishu 机器人。', 'Manage your Telegram and Feishu bots.')}
          </p>
        </div>
        <div className="settings-channel-header-actions">
          <span className={`channel-runtime-pill ${runtimeRunning ? 'running' : 'stopped'}`}>
            {runtimeRunning ? t(locale, '运行中', 'Running') : t(locale, '未就绪', 'Not Ready')}
          </span>
          <button 
            type="button" 
            className="settings-btn settings-btn-primary" 
            onClick={onAddChannel} 
            disabled={loading}
          >
            <AppIcon name="plus" className="vb-icon" />
            {t(locale, '添加 Channel', 'Add Channel')}
          </button>
        </div>
      </div>

      {channelBotGroups.length === 0 ? (
        <div className="settings-pane-section channel-empty-state">
          <p>
            {t(
              locale,
              variant === 'studio'
                ? '当前还没有已接入的 Channel。点击右上角“添加 Channel”开始配置，推荐先完成飞书。'
                : '当前没有已添加的 Channel。点击右上角“添加 Channel”开始配置。',
              variant === 'studio'
                ? 'No channels are connected yet. Click "Add Channel" to start setup. Feishu is recommended first.'
                : 'No channels added yet. Click "Add Channel" to start setup.',
            )}
          </p>
        </div>
      ) : (
        <div className="channel-bot-list">
          {channelBotGroups.map((group) => (
            <ChannelBotCard
              key={`${group.channel}:${group.accountId}`}
              group={group}
              locale={locale}
              roles={roles}
              agents={agents}
              onEditBinding={onEditBinding}
              onDeleteBinding={onDeleteBinding}
              onHealthCheckBinding={onHealthCheckBinding}
              healthCheckingKey={healthCheckingKey}
              loading={loading}
            />
          ))}
        </div>
      )}
    </>
  )
}
