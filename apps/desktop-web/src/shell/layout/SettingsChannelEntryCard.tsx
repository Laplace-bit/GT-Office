import { useEffect, useState } from 'react'
import { t, type Locale } from '../i18n/ui-locale'
import {
  desktopApi,
  type ChannelRouteBinding,
  type AgentRole,
  type AgentProfile,
} from '../integration/desktop-api'

const ROLE_TARGET_PREFIX = 'role:'

function parseBindingTarget(target: string): { type: 'role' | 'agent'; value: string } {
  const trimmed = target.trim()
  if (trimmed.startsWith(ROLE_TARGET_PREFIX)) {
    return { type: 'role', value: trimmed.slice(ROLE_TARGET_PREFIX.length).trim() }
  }
  return { type: 'agent', value: trimmed }
}

function channelLabel(locale: Locale, channel: string): string {
  if (channel === 'telegram') return 'Telegram'
  if (channel === 'feishu') return t(locale, '飞书', 'Feishu')
  return channel
}

interface SettingsChannelEntryCardProps {
  locale: Locale
  workspaceId: string | null
  onOpenManager: () => void
}

export function SettingsChannelEntryCard({
  locale,
  workspaceId,
  onOpenManager,
}: SettingsChannelEntryCardProps) {
  const [bindings, setBindings] = useState<ChannelRouteBinding[]>([])
  const [configuredChannels, setConfiguredChannels] = useState<Set<string>>(new Set())
  const [roles, setRoles] = useState<AgentRole[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])

  useEffect(() => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    const load = async () => {
      try {
        const { bindings } = await desktopApi.channelBindingList(workspaceId ?? undefined)
        setBindings(bindings)

        const activeSet = new Set<string>()
        bindings.forEach(b => activeSet.add(b.channel))

        try {
          const status = await desktopApi.channelAdapterStatus()
          if (status.runtime?.feishuWebhook) {
            activeSet.add('feishu')
          }
          const { accounts } = await desktopApi.channelConnectorAccountList('telegram')
          if (accounts.some(acc => acc.hasBotToken || (status.runtime?.telegramWebhook && acc.enabled))) {
            activeSet.add('telegram')
          }
        } catch {
          // ignore external errors
        }
        
        setConfiguredChannels(activeSet)

        if (workspaceId) {
          const [{ roles }, { agents }] = await Promise.all([
            desktopApi.agentRoleList(workspaceId),
            desktopApi.agentList(workspaceId),
          ])
          setRoles(roles)
          setAgents(agents)
        }
      } catch {
        // Ignore errors in list
      }
    }
    void load()
  }, [workspaceId])

  const roleById = new Map<string, AgentRole>()
  roles.forEach((r) => roleById.set(r.id, r))

  const roleLabelByKey = new Map<string, string>()
  roles.forEach((r) => {
    roleLabelByKey.set(r.roleKey, r.roleName)
    roleLabelByKey.set(r.id, r.roleName)
  })

  const agentLabelById = new Map<string, string>()
  agents.forEach((a) => {
    const role = roleById.get(a.roleId)
    const roleName = role?.roleName || role?.roleKey || '-'
    agentLabelById.set(a.id, `${a.name} (${a.id}) · ${roleName}`)
  })

  return (
    <section
      className="settings-channel-entry-card"
      aria-label={t(locale, 'settings.channel.entry.title')}
    >
      <header className="settings-channel-entry-header">
        <div>
          <h3>{t(locale, 'settings.channel.entry.title')}</h3>
          <p>{t(locale, 'settings.channel.entry.subtitle')}</p>
        </div>
        <button type="button" onClick={onOpenManager}>
          {t(locale, 'settings.channel.entry.open')}
        </button>
      </header>
      {configuredChannels.size > 0 ? (
        <ul className="settings-channel-entry-meta">
          {bindings
            .slice()
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .map((item) => {
              const target = parseBindingTarget(item.targetAgentId)
              const targetLabel =
                target.type === 'role'
                  ? roleLabelByKey.get(target.value) ?? target.value
                  : agentLabelById.get(target.value) ?? target.value
              return (
                <li key={`${item.channel}:${item.accountId ?? 'default'}:${item.targetAgentId}`}>
                  <span>{channelLabel(locale, item.channel)} ({item.accountId ?? 'default'})</span>
                  <strong>{targetLabel}</strong>
                </li>
              )
            })}
          {Array.from(configuredChannels).map(channel => {
            if (bindings.some(b => b.channel === channel)) return null;
            return (
              <li key={`unbound:${channel}`}>
                <span>{channelLabel(locale, channel)}</span>
                <strong style={{ color: 'var(--vb-text-muted)' }}>
                  {t(locale, '未绑定目标规则', 'No routing targets bound')}
                </strong>
              </li>
            )
          })}
        </ul>
      ) : (
        <div style={{ padding: '0 16px 16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          {t(locale, '未配置外部通道', 'No external channels configured')}
        </div>
      )}
    </section>
  )
}
