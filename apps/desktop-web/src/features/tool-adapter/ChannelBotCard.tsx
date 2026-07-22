import { t, type Locale } from '@shell/i18n/ui-locale'
import type { AgentProfile, ChannelRouteBinding } from '@shell/integration/desktop-api'
import {
  buildChannelRouteRowKey,
  normalizeChannelAccountId,
  type ChannelBotBindingGroup,
} from './channel-bot-binding-model'
import { AppIcon } from '@shell/ui/icons'

type ChannelBotGroup = ChannelBotBindingGroup

interface ChannelBotCardProps {
  group: ChannelBotGroup
  locale: Locale
  agents: AgentProfile[]
  onEditBinding: (binding: ChannelRouteBinding) => void
  onDeleteBinding: (binding: ChannelRouteBinding) => void
  onToggleBindingEnabled: (binding: ChannelRouteBinding, nextEnabled: boolean) => void
  onHealthCheckGroup: (group: ChannelBotGroup) => void
  onDeleteGroup: (group: ChannelBotGroup) => void
  healthCheckingKey: string | null
  loading: boolean
}

function formatBindingCreatedAt(locale: Locale, createdAtMs?: number | null): string {
  if (!Number.isFinite(createdAtMs) || !createdAtMs || createdAtMs <= 0) {
    return locale === 'zh-CN' ? '未知时间' : 'Unknown time'
  }
  const localeTag = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(localeTag, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(createdAtMs))
}

function buildHealthCheckKey(channel: string, accountId?: string | null): string {
  return `${channel.trim().toLowerCase()}::${normalizeChannelAccountId(accountId).toLowerCase()}`
}

export function ChannelBotCard({
  group,
  locale,
  agents,
  onEditBinding,
  onDeleteBinding,
  onToggleBindingEnabled,
  onHealthCheckGroup,
  onDeleteGroup,
  healthCheckingKey,
  loading,
}: ChannelBotCardProps) {
  const channelLabel =
    group.channel === 'telegram'
      ? 'Telegram'
      : group.channel === 'feishu'
      ? t(locale, '飞书', 'Feishu')
      : group.channel === 'wechat'
      ? t(locale, '微信', 'WeChat')
      : group.channel

  const getTargetLabel = (target: { type: string; value: string }) => {
    const agent = agents.find((agent) => agent.id === target.value)
    return agent ? agent.name : target.value
  }

  const groupHealthKey = buildHealthCheckKey(group.channel, group.accountId)
  const isHealthChecking = healthCheckingKey === groupHealthKey

  return (
    <div className="channel-bot-card">
      <header className="channel-bot-header">
        <div className="channel-bot-identity">
          <div className={`channel-bot-icon ${group.channel}`}>
            {group.channel === 'telegram' ? (
              <img src="/assets/logos/telegram.png" alt="Telegram" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }} />
            ) : group.channel === 'wechat' ? (
              <img src="/assets/logos/wechat.png" alt="WeChat" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }} />
            ) : group.channel === 'feishu' ? (
              <img src="/assets/logos/feishu.png" alt="Feishu" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }} />
            ) : (
              <AppIcon name="channels" className="vb-icon" />
            )}
          </div>
          <div className="channel-bot-meta">
            <h5>{channelLabel}</h5>
            <p>{t(locale, 'settings.channel.entry.botLabel', { accountId: group.accountId })}</p>
          </div>
        </div>
        <div className="channel-bot-stats">
          <span className="channel-bot-route-badge">
            {t(locale, 'settings.channel.entry.routeCount', { count: group.routes.length })}
          </span>
          <div className="channel-bot-header-actions">
            <button
              type="button"
              className={`channel-route-icon-btn ${isHealthChecking ? 'is-loading' : ''}`}
              onClick={() => onHealthCheckGroup(group)}
              disabled={loading || isHealthChecking}
              aria-label={t(locale, '检查连接', 'Check Connection')}
              title={t(locale, '检查连接', 'Check Connection')}
            >
              <AppIcon name="activity" className="vb-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="channel-route-icon-btn channel-route-icon-btn-danger"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteGroup(group)
              }}
              disabled={loading}
              aria-label={t(locale, '删除连接', 'Delete Connection')}
              title={t(locale, '删除连接', 'Delete Connection')}
            >
              <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {group.routes.length > 0 ? (
        <ul className="channel-bot-routes">
          {group.routes.map(({ binding, target }: { binding: ChannelRouteBinding; target: { type: string; value: string } }) => {
            const targetLabel = getTargetLabel(target)
            const accountId = normalizeChannelAccountId(binding.accountId)
            const botName = (binding.botName ?? '').trim() || (accountId === 'default' ? t(locale, '未识别 Bot', 'Unknown Bot') : accountId)
            const enabled = binding.enabled !== false
            const bindingSummary = `${botName} - ${targetLabel} - ${formatBindingCreatedAt(locale, binding.createdAtMs)}`

            return (
              <li key={buildChannelRouteRowKey(binding)} className="channel-bot-route-item">
                <div className="channel-bot-route-info">
                  <p className="channel-bot-route-binding" title={bindingSummary}>
                    {bindingSummary}
                  </p>
                  <p className="channel-bot-route-match">
                    {t(locale, '匹配: {kind} / {pattern}', 'Match: {kind} / {pattern}', {
                      kind: binding.peerKind ?? '*',
                      pattern: binding.peerPattern || '*',
                    })}
                    {' · '}
                    {enabled ? t(locale, '已启用', 'Enabled') : t(locale, '已停用', 'Disabled')}
                  </p>
                </div>
                <div className="channel-bot-route-actions">
                  <button
                    type="button"
                    className="channel-route-icon-btn"
                    onClick={() => onToggleBindingEnabled(binding, !enabled)}
                    disabled={loading}
                    aria-label={enabled ? t(locale, '停用绑定', 'Disable Binding') : t(locale, '启用绑定', 'Enable Binding')}
                    title={enabled ? t(locale, '停用绑定', 'Disable Binding') : t(locale, '启用绑定', 'Enable Binding')}
                  >
                    <AppIcon name={enabled ? 'minus' : 'check'} className="vb-icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="channel-route-icon-btn"
                    onClick={() => onEditBinding(binding)}
                    disabled={loading}
                    aria-label={t(locale, '编辑绑定', 'Edit Binding')}
                    title={t(locale, '编辑绑定', 'Edit Binding')}
                  >
                    <AppIcon name="pencil" className="vb-icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="channel-route-icon-btn channel-route-icon-btn-danger"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteBinding(binding)
                    }}
                    disabled={loading}
                    aria-label={t(locale, '删除路由', 'Delete Route')}
                    title={t(locale, '删除路由', 'Delete Route')}
                  >
                    <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="channel-bot-empty-routes" role="status" aria-label={t(locale, 'settings.channel.entry.noTarget')}>
          <span className="channel-bot-empty-line" aria-hidden="true" />
          <span className="channel-bot-empty-line short" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
