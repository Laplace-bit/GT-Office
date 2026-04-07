import { t, type Locale } from '@shell/i18n/ui-locale'
import { type ConnectorChannel } from './ChannelManagerPane'
import '../settings/ai-providers/shared/ProviderAgentCard.scss'

interface ChannelProviderCardProps {
  locale: Locale
  channel: ConnectorChannel
  botCount: number
  selected: boolean
  onSelect: () => void
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

const CHANNEL_LOGOS: Record<ConnectorChannel, string> = {
  wechat: '/assets/logos/wechat.png',
  feishu: '/assets/logos/feishu.png',
  telegram: '/assets/logos/telegram.png',
}

export function ChannelProviderCard({
  locale,
  channel,
  botCount,
  selected,
  onSelect,
}: ChannelProviderCardProps) {
  const isConfigured = botCount > 0
  const tone = isConfigured ? 'success' : 'muted'
  const title = getChannelDisplayName(locale, channel)

  return (
    <article
      className={`ai-provider-card ${selected ? 'is-active' : ''}`}
      onClick={onSelect}
    >
      <div className="ai-provider-card__header">
        <div className="ai-provider-card__icon">
          <img src={CHANNEL_LOGOS[channel]} alt={`${channel} logo`} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }} />
        </div>
        <div className="ai-provider-card__title">
          <h4>{title}</h4>
          <span className={`status-dot tone-${tone}`} />
        </div>
      </div>

      <div className="ai-provider-card__status">
        {isConfigured ? (
          <div className="pac-status-chip is-success">
            {/* Note: if you still need icons inside status chips, they can be imported back */}
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>{t(locale, '{count} 个连接', '{count} connections', { count: String(botCount) })}</span>
          </div>
        ) : (
          <div className="pac-status-chip is-warning">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m8 17 4 4 4-4"></path></svg>
            <span>{t(locale, '未配置', 'Not configured')}</span>
          </div>
        )}
      </div>

    </article>
  )
}
