import { useCallback, useEffect, useState } from 'react'
import { desktopApi, type AgentRole, type AgentProfile, type ChannelConnectorAccount, type ChannelRouteBinding } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  buildChannelBotBindingGroups,
  isConfiguredChannelBotGroup,
  matchesChannelBindingIdentity,
  normalizeChannelAccountId,
} from './channel-bot-binding-model'
import { resolveConnectorAccounts } from './channel-connector-runtime'
import { ChannelProviderCard } from './ChannelProviderCard'
import { ChannelConfigurationModal } from './ChannelConfigurationModal'
import { ChannelOverview } from './ChannelOverview'
import { ChannelWizard } from './ChannelWizard'
import { ChannelBindingDeleteConfirmDialog } from './ChannelBindingDeleteConfirmDialog'

export type ConnectorChannel = 'feishu' | 'telegram' | 'wechat'

const SUPPORTED_CHANNELS: ConnectorChannel[] = ['wechat', 'feishu', 'telegram']
type ChannelBotGroup = ReturnType<typeof buildChannelBotBindingGroups>[number]

type DeleteConfirmState =
  | { kind: 'route'; binding: ChannelRouteBinding }
  | { kind: 'connection'; group: ChannelBotGroup }
  | null

interface ChannelManagerPaneProps {
  locale: Locale
  workspaceId: string | null
  variant?: 'embedded' | 'studio' | 'settings'
  onEnterStudio?: () => void
  onClose?: () => void
}

function describeError(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  return 'unknown'
}

function buildHealthCheckKey(channel: string, accountId?: string | null): string {
  return `${channel.trim().toLowerCase()}::${normalizeChannelAccountId(accountId).toLowerCase()}`
}

function matchesChannelAccount(binding: ChannelRouteBinding, channel: string, accountId?: string | null): boolean {
  return (
    binding.channel.trim().toLowerCase() === channel.trim().toLowerCase() &&
    normalizeChannelAccountId(binding.accountId).toLowerCase() ===
      normalizeChannelAccountId(accountId).toLowerCase()
  )
}

function formatCheckedAt(locale: Locale, timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
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
  }).format(new Date(timestampMs))
}

export function ChannelManagerPane({ locale, workspaceId, variant = 'embedded', onEnterStudio, onClose }: ChannelManagerPaneProps) {
  const [loading, setLoading] = useState(false)
  const [healthCheckingKey, setHealthCheckingKey] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [runtimeRunning, setRuntimeRunning] = useState(false)
  const [feishuWebhook, setFeishuWebhook] = useState('')
  const [telegramWebhook, setTelegramWebhook] = useState('')

  const [roles, setRoles] = useState<AgentRole[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [bindings, setBindings] = useState<ChannelRouteBinding[]>([])
  const [connectorAccounts, setConnectorAccounts] = useState<ChannelConnectorAccount[]>([])

  const [wizardOpen, setWizardOpen] = useState(variant === 'studio')
  const [editingBinding, setEditingBinding] = useState<ChannelRouteBinding | null>(null)
  const [configChannel, setConfigChannel] = useState<ConnectorChannel | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null)

  const loadRuntimeStatus = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      setStatusMessage(t(locale, '当前是 Web 预览模式，通道接入配置不可用。', 'Web preview mode detected. Channel onboarding is unavailable.'))
      return
    }

    setLoading(true)
    setErrorMessage(null)
    try {
      const status = await desktopApi.channelAdapterStatus()
      const runtime = status.runtime
      const statusAccounts = await resolveConnectorAccounts(status, (channel) =>
        desktopApi.channelConnectorAccountList(channel),
      )
      setRuntimeRunning(Boolean(status.running))
      setFeishuWebhook(runtime?.feishuWebhook ?? '')
      setTelegramWebhook(runtime?.telegramWebhook ?? '')
      setConnectorAccounts(statusAccounts)
    } catch (error) {
      setErrorMessage(t(locale, '读取通道状态失败: {detail}', 'Failed to load channel status: {detail}', { detail: describeError(error) }))
    } finally {
      setLoading(false)
    }
  }, [locale])

  const loadBindingsAndRoles = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) return
    const tasks: Array<Promise<unknown>> = [
      desktopApi.channelBindingList(workspaceId ?? undefined).then((response) => setBindings(response.bindings)),
    ]
    if (workspaceId) {
      tasks.push(desktopApi.agentRoleList(workspaceId).then((response) => setRoles(response.roles)))
      tasks.push(desktopApi.agentList(workspaceId).then((response) => setAgents(response.agents)))
    } else {
      setRoles([])
      setAgents([])
    }
    try {
      await Promise.all(tasks)
    } catch {
      // Best effort
    }
  }, [workspaceId])

  useEffect(() => {
    void loadRuntimeStatus()
  }, [loadRuntimeStatus])

  useEffect(() => {
    void loadBindingsAndRoles()
  }, [loadBindingsAndRoles])

  const handleAddChannelClick = () => {
    if (variant === 'settings') {
      onEnterStudio?.()
      return
    }

    setEditingBinding(null)
    setWizardOpen(true)
  }

  const handleEditBinding = (binding: ChannelRouteBinding) => {
    if (variant === 'settings') {
      onEnterStudio?.()
      return
    }

    setEditingBinding(binding)
    setWizardOpen(true)
  }

  const handleRequestDeleteBinding = (binding: ChannelRouteBinding) => {
    if (!desktopApi.isTauriRuntime()) {
      setErrorMessage(
        t(locale, '当前为 Web 预览模式，无法删除路由。请使用桌面应用。', 'Route deletion is unavailable in web preview. Use the desktop app.'),
      )
      return
    }
    setErrorMessage(null)
    setStatusMessage(null)
    setDeleteConfirm({ kind: 'route', binding })
  }

  const executeDeleteBinding = async (binding: ChannelRouteBinding) => {
    setLoading(true)
    setStatusMessage(t(locale, '正在删除路由…', 'Deleting route…'))
    setErrorMessage(null)
    try {
      const result = await desktopApi.channelBindingDelete(binding)
      if (!result.deleted) {
        setStatusMessage(null)
        setErrorMessage(
          t(
            locale,
            '未找到要删除的路由绑定，可能已被删除或账号标识不一致。',
            'Route binding was not found. It may have been removed already or the account identity no longer matches.',
          ),
        )
        return
      }
      setBindings((current) => current.filter((entry) => !matchesChannelBindingIdentity(entry, binding)))
      await loadBindingsAndRoles()
      setStatusMessage(t(locale, '已删除路由绑定。', 'Route binding deleted.'))
      setTimeout(() => setStatusMessage(null), 4000)
    } catch (error) {
      setStatusMessage(null)
      setErrorMessage(t(locale, '删除绑定失败: {detail}', 'Failed to delete binding: {detail}', { detail: describeError(error) }))
    } finally {
      setLoading(false)
      setDeleteConfirm(null)
    }
  }

  const handleToggleBindingEnabled = async (binding: ChannelRouteBinding, nextEnabled: boolean) => {
    setLoading(true)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      await desktopApi.channelBindingUpsert({
        ...binding,
        enabled: nextEnabled,
      })
      await loadBindingsAndRoles()
      setStatusMessage(
        nextEnabled
          ? t(locale, '已启用路由绑定。', 'Route binding enabled.')
          : t(locale, '已停用路由绑定。', 'Route binding disabled.'),
      )
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (error) {
      setErrorMessage(
        t(locale, '更新绑定状态失败: {detail}', 'Failed to update binding status: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setLoading(false)
    }
  }

  const handleHealthCheckGroup = async (group: ChannelBotGroup) => {
    const healthCheckKey = buildHealthCheckKey(group.channel, group.accountId)
    setHealthCheckingKey(healthCheckKey)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const response = await desktopApi.channelConnectorHealth(group.channel, group.accountId ?? null)
      const health = response.health
      const healthBotName = (health.botName ?? health.botUsername ?? '').trim()
      const accountBindings = bindings.filter((binding) =>
        matchesChannelAccount(binding, group.channel, group.accountId),
      )
      const bindingsToRefresh = healthBotName
        ? accountBindings.filter((binding) => (binding.botName ?? '').trim() !== healthBotName)
        : []
      if (bindingsToRefresh.length > 0) {
        await Promise.all(
          bindingsToRefresh.map((binding) =>
            desktopApi.channelBindingUpsert({
              ...binding,
              botName: healthBotName,
            }),
          ),
        )
        await loadBindingsAndRoles()
      }
      const previousBotName =
        accountBindings
          .map((binding) => (binding.botName ?? '').trim())
          .find((value) => value.length > 0) ?? ''
      const botName =
        healthBotName || previousBotName || normalizeChannelAccountId(group.accountId)
      const checkedAt = formatCheckedAt(locale, health.checkedAtMs)
      if (health.ok) {
        setStatusMessage(
          t(locale, '健康检查通过：{bot} · {time}', 'Health check passed: {bot} · {time}', {
            bot: botName,
            time: checkedAt,
          }),
        )
        setTimeout(() => setStatusMessage(null), 4000)
      } else {
        setErrorMessage(
          t(locale, '健康检查异常：{bot} · {status} · {detail}', 'Health check failed: {bot} · {status} · {detail}', {
            bot: botName,
            status: health.status,
            detail: health.detail || '-',
          }),
        )
      }
    } catch (error) {
      setErrorMessage(
        t(locale, '健康检查失败: {detail}', 'Health check failed: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setHealthCheckingKey(null)
    }
  }

  const handleRequestDeleteGroup = (group: ChannelBotGroup) => {
    if (!desktopApi.isTauriRuntime()) {
      setErrorMessage(
        t(locale, '当前为 Web 预览模式，无法删除连接。请使用桌面应用。', 'Connection deletion is unavailable in web preview. Use the desktop app.'),
      )
      return
    }
    setErrorMessage(null)
    setStatusMessage(null)
    setDeleteConfirm({ kind: 'connection', group })
  }

  const executeDeleteGroup = async (group: ChannelBotGroup) => {
    setLoading(true)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const result = await desktopApi.channelConnectorAccountDelete(group.channel, group.accountId)
      setBindings((current) =>
        current.filter(
          (binding) =>
            !(
              binding.channel.trim().toLowerCase() === group.channel.trim().toLowerCase() &&
              normalizeChannelAccountId(binding.accountId).toLowerCase() ===
                normalizeChannelAccountId(group.accountId).toLowerCase()
            ),
        ),
      )
      setConnectorAccounts((current) =>
        current.filter(
          (account) =>
            !(
              account.channel.trim().toLowerCase() === group.channel.trim().toLowerCase() &&
              normalizeChannelAccountId(account.accountId).toLowerCase() ===
                normalizeChannelAccountId(group.accountId).toLowerCase()
            ),
        ),
      )
      await loadBindingsAndRoles()
      await loadRuntimeStatus()
      setStatusMessage(
        t(
          locale,
          '已删除连接 {account}，移除 {count} 条路由。',
          'Deleted connection {account} and removed {count} routes.',
          {
            account: normalizeChannelAccountId(result.accountId),
            count: result.deletedBindings,
          },
        ),
      )
      setTimeout(() => setStatusMessage(null), 4000)
    } catch (error) {
      setErrorMessage(
        t(locale, '删除连接失败: {detail}', 'Failed to delete connection: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setLoading(false)
      setDeleteConfirm(null)
    }
  }

  const handleDeleteConfirmCancel = () => {
    if (loading) {
      return
    }
    setDeleteConfirm(null)
    setStatusMessage(t(locale, '已取消删除。', 'Delete cancelled.'))
    setTimeout(() => setStatusMessage(null), 2500)
  }

  const handleWizardClose = () => {
    if (variant === 'studio') {
      onClose?.()
      return
    }
    setWizardOpen(false)
    setEditingBinding(null)
  }

  const handleWizardSuccess = (message: string) => {
    setWizardOpen(false)
    setEditingBinding(null)
    setStatusMessage(message)
    void loadBindingsAndRoles()
    void loadRuntimeStatus()
    setTimeout(() => setStatusMessage(null), 3000)
  }

  const addedChannels = Array.from(
    new Set([
      ...bindings.filter(b => b.channel === 'telegram' || b.channel === 'feishu' || b.channel === 'wechat').map(b => b.channel as ConnectorChannel),
      ...connectorAccounts.filter(a => a.channel === 'telegram' || a.channel === 'feishu' || a.channel === 'wechat').map(a => a.channel as ConnectorChannel),
      ...(telegramWebhook ? ['telegram' as const] : []),
      ...(feishuWebhook ? ['feishu' as const] : [])
    ])
  ).sort()

  const channelBotGroups = buildChannelBotBindingGroups({
    bindings,
    accounts: connectorAccounts,
    configuredChannels: addedChannels,
  })
  const configuredChannelBotGroups = channelBotGroups.filter(isConfiguredChannelBotGroup)

  if (wizardOpen && variant === 'studio') {
    return (
      <ChannelWizard 
        locale={locale}
        workspaceId={workspaceId}
        onClose={handleWizardClose}
        onSuccess={handleWizardSuccess}
        editingBinding={editingBinding}
        roles={roles}
        agents={agents}
        connectorAccounts={connectorAccounts}
        addedChannels={addedChannels}
        telegramWebhook={telegramWebhook}
        feishuWebhook={feishuWebhook}
      />
    )
  }

  return (
    <div className={`channel-manager-pane ${variant === 'studio' ? 'is-studio' : ''}`}>
      {variant === 'studio' ? (
        <ChannelOverview 
          locale={locale}
          variant={variant}
          runtimeRunning={runtimeRunning}
          onAddChannel={handleAddChannelClick}
          channelBotGroups={configuredChannelBotGroups}
          roles={roles}
          agents={agents}
          onEditBinding={handleEditBinding}
          onDeleteBinding={handleRequestDeleteBinding}
          onDeleteGroup={handleRequestDeleteGroup}
          onToggleBindingEnabled={handleToggleBindingEnabled}
          onHealthCheckGroup={handleHealthCheckGroup}
          healthCheckingKey={healthCheckingKey}
          loading={loading}
          statusMessage={statusMessage}
          errorMessage={errorMessage}
        />
      ) : (
        <>
          <div className="channel-overview-top settings">
            <div className="channel-overview-status">
              <h4>{t(locale, '通道概览', 'Channel Overview')}</h4>
              <p>{t(locale, '查看当前绑定的机器人与路由状态。', 'View the status of currently bound bots and routes.')}</p>
            </div>
            <div className="settings-channel-header-actions">
              <span className={`channel-runtime-pill ${runtimeRunning ? 'running' : 'stopped'}`}>
                {runtimeRunning ? t(locale, '网络连接正常', 'Network Connected') : t(locale, '未就绪', 'Not Ready')}
              </span>
            </div>
          </div>
          <div className="channel-providers-list" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
            {SUPPORTED_CHANNELS.map((channel) => {
              const groupsForChannel = configuredChannelBotGroups.filter(g => g.channel === channel)
              const botCount = groupsForChannel.length
              
              return (
                <ChannelProviderCard
                  key={channel}
                  locale={locale}
                  channel={channel}
                  botCount={botCount}
                  selected={configChannel === channel}
                  onSelect={() => setConfigChannel(channel)}
                />
              )
            })}
          </div>

          {configChannel && (
            <ChannelConfigurationModal
              locale={locale}
              workspaceId={workspaceId}
              channel={configChannel}
              botGroups={configuredChannelBotGroups.filter(g => g.channel === configChannel)}
              roles={roles}
              agents={agents}
              onClose={() => setConfigChannel(null)}
              onDeleteBinding={handleRequestDeleteBinding}
              onDeleteGroup={handleRequestDeleteGroup}
              onToggleBindingEnabled={handleToggleBindingEnabled}
              onHealthCheckGroup={handleHealthCheckGroup}
              onWizardSuccess={handleWizardSuccess}
              healthCheckingKey={healthCheckingKey}
              loading={loading}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              connectorAccounts={connectorAccounts}
              telegramWebhook={telegramWebhook}
              feishuWebhook={feishuWebhook}
              addedChannels={addedChannels}
            />
          )}
        </>
      )}
      
      {statusMessage && <p className="settings-channel-message">{statusMessage}</p>}
      {errorMessage && <p className="settings-channel-error">{errorMessage}</p>}

      {deleteConfirm?.kind === 'route' ? (
        <ChannelBindingDeleteConfirmDialog
          locale={locale}
          kind="route"
          title={t(locale, '删除路由', 'Delete Route')}
          description={t(
            locale,
            '删除后该匹配规则将不再把消息转发到对应 Agent。此操作不可撤销。',
            'This removes the routing rule and stops forwarding messages to the bound agent. This cannot be undone.',
          )}
          detail={t(locale, '目标: {target} · 匹配: {kind}/{pattern}', 'Target: {target} · Match: {kind}/{pattern}', {
            target: deleteConfirm.binding.targetAgentId,
            kind: deleteConfirm.binding.peerKind ?? '*',
            pattern: deleteConfirm.binding.peerPattern || '*',
          })}
          loading={loading}
          onCancel={handleDeleteConfirmCancel}
          onConfirm={() => void executeDeleteBinding(deleteConfirm.binding)}
        />
      ) : null}

      {deleteConfirm?.kind === 'connection' ? (
        <ChannelBindingDeleteConfirmDialog
          locale={locale}
          kind="connection"
          title={t(locale, '删除连接', 'Delete Connection')}
          description={t(
            locale,
            '这会删除该 Bot 账号凭证，并移除其下所有路由绑定。',
            'This removes the bot account credentials and every route bound to it.',
          )}
          detail={t(locale, '账号: {account}', 'Account: {account}', {
            account: normalizeChannelAccountId(deleteConfirm.group.accountId),
          })}
          loading={loading}
          onCancel={handleDeleteConfirmCancel}
          onConfirm={() => void executeDeleteGroup(deleteConfirm.group)}
        />
      ) : null}
    </div>
  )
}
