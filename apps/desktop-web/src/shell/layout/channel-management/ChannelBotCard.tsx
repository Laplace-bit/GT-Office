import { t, type Locale } from '../../i18n/ui-locale'
import type { AgentRole, AgentProfile, ChannelRouteBinding } from '../../integration/desktop-api'
import type { buildChannelBotBindingGroups } from '../channel-bot-binding-model'

type ChannelBotGroup = ReturnType<typeof buildChannelBotBindingGroups>[number]

interface ChannelBotCardProps {
  group: ChannelBotGroup
  locale: Locale
  roles: AgentRole[]
  agents: AgentProfile[]
  onEditBinding: (binding: ChannelRouteBinding) => void
  onDeleteBinding: (binding: ChannelRouteBinding) => void
  loading: boolean
}

export function ChannelBotCard({ group, locale, roles, agents, onEditBinding, onDeleteBinding, loading }: ChannelBotCardProps) {
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
            {group.channel === 'telegram' ? '✈️' : group.channel === 'feishu' ? '💬' : '🤖'}
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
          {group.routes.map(({ binding, target }: { binding: ChannelRouteBinding; target: { type: string; value: string } }) => (
            <li key={`${binding.channel}:${binding.accountId}:${binding.peerPattern}:${binding.targetAgentId}`} className="channel-bot-route-item">
              <div className="channel-bot-route-info">
                <span className="channel-bot-route-badge" title="Peer Kind">{binding.peerKind ?? '*'}</span>
                <span className="channel-bot-route-pattern" title="Pattern">{binding.peerPattern || '*'}</span>
                <span style={{ color: 'var(--vb-text-muted)' }}>→</span>
                <span className="channel-bot-route-target">{getTargetLabel(target)}</span>
              </div>
              <div className="channel-bot-route-actions">
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={() => onEditBinding(binding)}
                  disabled={loading}
                >
                  {t(locale, '编辑', 'Edit')}
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn-danger"
                  onClick={() => onDeleteBinding(binding)}
                  disabled={loading}
                >
                  {t(locale, '删除', 'Delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ padding: '16px 20px', color: 'var(--vb-text-muted)', fontSize: '0.8125rem' }}>
          {t(locale, 'settings.channel.entry.noTarget')}
        </div>
      )}
    </div>
  )
}
