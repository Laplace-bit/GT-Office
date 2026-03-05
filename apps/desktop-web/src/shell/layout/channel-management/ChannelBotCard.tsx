import { t, type Locale } from '../../i18n/ui-locale'
import type { AgentRole, AgentProfile, ChannelRouteBinding } from '../../integration/desktop-api'
import { normalizeChannelAccountId, type buildChannelBotBindingGroups } from '../channel-bot-binding-model'
import { AppIcon } from '../../ui/icons'

type ChannelBotGroup = ReturnType<typeof buildChannelBotBindingGroups>[number]

interface ChannelBotCardProps {
  group: ChannelBotGroup
  locale: Locale
  roles: AgentRole[]
  agents: AgentProfile[]
  onEditBinding: (binding: ChannelRouteBinding) => void
  onDeleteBinding: (binding: ChannelRouteBinding) => void
  onHealthCheckBinding: (binding: ChannelRouteBinding) => void
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

function buildHealthCheckKey(binding: ChannelRouteBinding): string {
  return `${binding.channel.trim().toLowerCase()}::${normalizeChannelAccountId(binding.accountId).toLowerCase()}`
}

export function ChannelBotCard({
  group,
  locale,
  roles,
  agents,
  onEditBinding,
  onDeleteBinding,
  onHealthCheckBinding,
  healthCheckingKey,
  loading,
}: ChannelBotCardProps) {
  const channelLabel = group.channel === 'telegram' ? 'Telegram' : group.channel === 'feishu' ? 'Feishu' : group.channel

  const getTargetLabel = (target: { type: string; value: string }) => {
    if (target.type === 'role') {
      const role = roles.find(r => r.roleKey === target.value || r.id === target.value)
      return role ? role.roleName : target.value
    } else {
      const agent = agents.find(a => a.id === target.value)
      return agent ? agent.name : target.value
    }
  }

  return (
    <div className="channel-bot-card">
      <header className="channel-bot-header">
        <div className="channel-bot-identity">
          <div className={`channel-bot-icon ${group.channel}`}>
            {group.channel === 'telegram' ? (
              <AppIcon name="telegram" className="vb-icon" />
            ) : group.channel === 'feishu' ? (
              <AppIcon name="feishu" className="vb-icon" />
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
        </div>
      </header>

      {group.routes.length > 0 ? (
        <ul className="channel-bot-routes">
          {group.routes.map(({ binding, target }: { binding: ChannelRouteBinding; target: { type: string; value: string } }) => {
            const targetLabel = getTargetLabel(target)
            const routeHealthKey = buildHealthCheckKey(binding)
            const isHealthChecking = healthCheckingKey === routeHealthKey
            const accountId = normalizeChannelAccountId(binding.accountId)
            const botName = (binding.botName ?? '').trim() || (accountId === 'default' ? t(locale, '未识别 Bot', 'Unknown Bot') : accountId)
            const bindingSummary = `${botName} - ${targetLabel} - ${formatBindingCreatedAt(locale, binding.createdAtMs)}`

            return (
              <li key={`${binding.channel}:${binding.accountId}:${binding.peerPattern}:${binding.targetAgentId}`} className="channel-bot-route-item">
                <div className="channel-bot-route-info">
                  <p className="channel-bot-route-binding" title={bindingSummary}>
                    {bindingSummary}
                  </p>
                  <p className="channel-bot-route-match">
                    {t(locale, '匹配: {kind} / {pattern}', 'Match: {kind} / {pattern}', {
                      kind: binding.peerKind ?? '*',
                      pattern: binding.peerPattern || '*',
                    })}
                  </p>
                </div>
                <div className="channel-bot-route-actions">
                  <button
                    type="button"
                    className={`channel-route-icon-btn ${isHealthChecking ? 'is-loading' : ''}`}
                    onClick={() => onHealthCheckBinding(binding)}
                    disabled={loading || isHealthChecking}
                    aria-label={t(locale, '健康检查', 'Health Check')}
                    title={t(locale, '健康检查', 'Health Check')}
                  >
                    <AppIcon name="activity" className="vb-icon" aria-hidden="true" />
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
                    onClick={() => onDeleteBinding(binding)}
                    disabled={loading}
                    aria-label={t(locale, '删除', 'Delete')}
                    title={t(locale, '删除', 'Delete')}
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
