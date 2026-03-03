import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  desktopApi,
  type AgentProfile,
  type AgentRole,
  type ChannelRouteBinding,
  type ExternalAccessPolicyMode,
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'

type ConnectorChannel = 'feishu' | 'telegram'

interface SettingsChannelOnboardingPaneProps {
  locale: Locale
  workspaceId: string | null
}

interface WizardForm {
  channel: ConnectorChannel
  accountId: string
  peerKind: 'direct' | 'group'
  peerPattern: string
  targetBindingType: 'role' | 'agent'
  targetRoleKey: string
  targetAgentId: string
  telegramBotToken: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
}

const WIZARD_STEP_COUNT = 4
const ROLE_TARGET_PREFIX = 'role:'

const DEFAULT_WIZARD_FORM: WizardForm = {
  channel: 'telegram',
  accountId: 'default',
  peerKind: 'direct',
  peerPattern: '',
  targetBindingType: 'role',
  targetRoleKey: '',
  targetAgentId: '',
  telegramBotToken: '',
  priority: 100,
  policyMode: 'open',
  approveIdentities: '',
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

function normalizeAccountId(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'default'
}

function normalizeRoleTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith(ROLE_TARGET_PREFIX) ? trimmed : `${ROLE_TARGET_PREFIX}${trimmed}`
}

function parseRoleTarget(target: string): string {
  const trimmed = target.trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed.startsWith(ROLE_TARGET_PREFIX)) {
    return trimmed.slice(ROLE_TARGET_PREFIX.length).trim()
  }
  return ''
}

function normalizeAgentTarget(value: string): string {
  return value.trim()
}

function parseBindingTarget(target: string): { type: 'role' | 'agent'; value: string } {
  const roleKey = parseRoleTarget(target)
  if (roleKey) {
    return { type: 'role', value: roleKey }
  }
  return { type: 'agent', value: normalizeAgentTarget(target) }
}

function parseIdentities(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]/g)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
}


function channelLabel(locale: Locale, channel: ConnectorChannel): string {
  return channel === 'telegram' ? t(locale, 'Telegram', 'Telegram') : t(locale, '飞书', 'Feishu')
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value.trim()) {
    return false
  }
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    return false
  }
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function SettingsChannelOnboardingPane({
  locale,
  workspaceId,
}: SettingsChannelOnboardingPaneProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [runtimeRunning, setRuntimeRunning] = useState(false)
  const [feishuWebhook, setFeishuWebhook] = useState('')
  const [telegramWebhook, setTelegramWebhook] = useState('')

  const [roles, setRoles] = useState<AgentRole[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [bindings, setBindings] = useState<ChannelRouteBinding[]>([])

  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardForm, setWizardForm] = useState<WizardForm>(DEFAULT_WIZARD_FORM)
  const [wizardAccessEntries, setWizardAccessEntries] = useState<
    Array<{
      channel: string
      accountId: string
      identity: string
      approved: boolean
    }>
  >([])

  const workspaceBound = workspaceId !== null

  const activeRoles = useMemo(
    () => roles.filter((role) => role.status !== 'disabled'),
    [roles],
  )

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.state !== 'terminated'),
    [agents],
  )

  const roleLabelByKey = useMemo(() => {
    const map = new Map<string, string>()
    activeRoles.forEach((role) => {
      map.set(role.roleKey, role.roleName)
      map.set(role.id, role.roleName)
    })
    return map
  }, [activeRoles])

  const roleById = useMemo(() => {
    const map = new Map<string, AgentRole>()
    roles.forEach((role) => {
      map.set(role.id, role)
    })
    return map
  }, [roles])

  const agentLabelById = useMemo(() => {
    const map = new Map<string, string>()
    activeAgents.forEach((agent) => {
      const role = roleById.get(agent.roleId)
      const roleName = role?.roleName || role?.roleKey || '-'
      map.set(agent.id, `${agent.name} (${agent.id}) · ${roleName}`)
    })
    return map
  }, [activeAgents, roleById])

  const channelBindingsMap = useMemo(() => {
    const map = new Map<ConnectorChannel, ChannelRouteBinding[]>()
    bindings.forEach((binding) => {
      if (binding.channel !== 'telegram' && binding.channel !== 'feishu') {
        return
      }
      const channel = binding.channel as ConnectorChannel
      const current = map.get(channel) ?? []
      current.push(binding)
      map.set(channel, current)
    })
    for (const [channel, items] of map.entries()) {
      items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      map.set(channel, items)
    }
    return map
  }, [bindings])

  const addedChannels = useMemo(() => {
    return (Array.from(channelBindingsMap.keys()) as ConnectorChannel[]).sort()
  }, [channelBindingsMap])

  const currentWebhook = wizardForm.channel === 'telegram' ? telegramWebhook : feishuWebhook

  const prefillFormForChannel = useCallback(
    (channel: ConnectorChannel, fallbackRoleKey?: string, fallbackAgentId?: string): WizardForm => {
      const preferred = (channelBindingsMap.get(channel) ?? [])[0]
      const preferredTarget = preferred
        ? parseBindingTarget(preferred.targetAgentId)
        : { type: 'role' as const, value: '' }
      const defaultRole = fallbackRoleKey ?? activeRoles[0]?.roleKey ?? ''
      const defaultAgent = fallbackAgentId ?? activeAgents[0]?.id ?? ''
      return {
        channel,
        accountId: preferred?.accountId ?? 'default',
        peerKind: preferred?.peerKind ?? 'direct',
        peerPattern: preferred?.peerPattern ?? '',
        targetBindingType: preferredTarget.type,
        targetRoleKey: preferredTarget.type === 'role' ? preferredTarget.value || defaultRole : defaultRole,
        targetAgentId:
          preferredTarget.type === 'agent' ? preferredTarget.value || defaultAgent : defaultAgent,
        telegramBotToken: '',
        priority: preferred?.priority ?? 100,
        policyMode: 'open',
        approveIdentities: '',
      }
    },
    [activeAgents, activeRoles, channelBindingsMap],
  )

  const loadRuntimeStatus = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      setStatusMessage(
        t(
          locale,
          '当前是 Web 预览模式，通道接入配置不可用。',
          'Web preview mode detected. Channel onboarding is unavailable.',
        ),
      )
      return
    }

    setLoading(true)
    setErrorMessage(null)
    try {
      const status = await desktopApi.channelAdapterStatus()
      const runtime = status.runtime
      setRuntimeRunning(Boolean(status.running))
      setFeishuWebhook(runtime?.feishuWebhook ?? '')
      setTelegramWebhook(runtime?.telegramWebhook ?? '')
      setStatusMessage(t(locale, '通道状态已刷新。', 'Channel status refreshed.'))
    } catch (error) {
      setErrorMessage(
        t(locale, '读取通道状态失败: {detail}', 'Failed to load channel status: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [locale])

  const loadBindingsAndRoles = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    const tasks: Array<Promise<unknown>> = [
      desktopApi.channelBindingList(workspaceId ?? undefined).then((response) => {
        setBindings(response.bindings)
      }),
    ]

    if (workspaceId) {
      tasks.push(
        desktopApi.agentRoleList(workspaceId).then((response) => {
          setRoles(response.roles)
        }),
      )
      tasks.push(
        desktopApi.agentList(workspaceId).then((response) => {
          setAgents(response.agents)
        }),
      )
    } else {
      setRoles([])
      setAgents([])
    }

    try {
      await Promise.all(tasks)
    } catch {
      // Best effort loading for setup UX.
    }
  }, [workspaceId])

  const loadWizardAccessEntries = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      setWizardAccessEntries([])
      return
    }
    try {
      const response = await desktopApi.channelAccessList(
        wizardForm.channel,
        normalizeAccountId(wizardForm.accountId),
      )
      setWizardAccessEntries(response.entries)
    } catch {
      setWizardAccessEntries([])
    }
  }, [wizardForm.accountId, wizardForm.channel])

  useEffect(() => {
    void loadRuntimeStatus()
  }, [loadRuntimeStatus])

  useEffect(() => {
    void loadBindingsAndRoles()
  }, [loadBindingsAndRoles])

  useEffect(() => {
    if (!wizardOpen) {
      return
    }
    void loadWizardAccessEntries()
  }, [wizardOpen, loadWizardAccessEntries])

  useEffect(() => {
    if (!wizardOpen) {
      document.body.classList.remove('settings-channel-wizard-open')
      return
    }
    document.body.classList.add('settings-channel-wizard-open')
    return () => {
      document.body.classList.remove('settings-channel-wizard-open')
    }
  }, [wizardOpen])

  useEffect(() => {
    if (!wizardOpen) {
      return
    }
    if (wizardForm.targetBindingType === 'role') {
      if (wizardForm.targetRoleKey.trim().length > 0 || activeRoles.length === 0) {
        return
      }
      setWizardForm((prev) => ({
        ...prev,
        targetRoleKey: activeRoles[0]?.roleKey ?? '',
      }))
      return
    }
    if (wizardForm.targetAgentId.trim().length > 0 || activeAgents.length === 0) {
      return
    }
    setWizardForm((prev) => ({
      ...prev,
      targetAgentId: activeAgents[0]?.id ?? '',
    }))
  }, [
    activeAgents,
    activeRoles,
    wizardForm.targetAgentId,
    wizardForm.targetBindingType,
    wizardForm.targetRoleKey,
    wizardOpen,
  ])

  const openWizard = useCallback(
    (channel?: ConnectorChannel) => {
      const nextChannel =
        channel ??
        (addedChannels[0] as ConnectorChannel | undefined) ??
        ('telegram' as ConnectorChannel)
      const form = prefillFormForChannel(nextChannel)
      setWizardForm(form)
      setWizardStep(0)
      setWizardOpen(true)
      setErrorMessage(null)
      setStatusMessage(null)
    },
    [addedChannels, prefillFormForChannel],
  )

  const closeWizard = useCallback(() => {
    if (saving) {
      return
    }
    setWizardOpen(false)
    setWizardStep(0)
    setWizardAccessEntries([])
  }, [saving])

  const editBinding = useCallback((binding: ChannelRouteBinding) => {
    const target = parseBindingTarget(binding.targetAgentId)
    setWizardForm({
      channel: binding.channel as ConnectorChannel,
      accountId: binding.accountId ?? 'default',
      peerKind: binding.peerKind === 'group' ? 'group' : 'direct',
      peerPattern: binding.peerPattern ?? '',
      targetBindingType: target.type,
      targetRoleKey: target.type === 'role' ? target.value : '',
      targetAgentId: target.type === 'agent' ? target.value : '',
      telegramBotToken: '',
      priority: binding.priority ?? 100,
      policyMode: 'open',
      approveIdentities: '',
    })
    setWizardStep(1) // goto step 2 for editing targets
    setWizardOpen(true)
    setErrorMessage(null)
    setStatusMessage(null)
  }, [])

  const deleteBinding = useCallback(async (binding: ChannelRouteBinding) => {
    if (!window.confirm(t(locale, '确定要删除这条通道路由绑定吗？', 'Are you sure you want to delete this channel route binding?'))) {
      return
    }
    setLoading(true)
    try {
      await desktopApi.channelBindingDelete(binding)
      await loadBindingsAndRoles()
      setStatusMessage(t(locale, '已删除路由绑定。', 'Route binding deleted.'))
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (error) {
      setErrorMessage(t(locale, '删除绑定失败: {detail}', 'Failed to delete binding: {detail}', { detail: describeError(error) }))
    } finally {
      setLoading(false)
    }
  }, [locale, loadBindingsAndRoles])

  const updateWizardField = useCallback(
    <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
      setWizardForm((prev) => ({
        ...prev,
        [key]: value,
      }))
    },
    [],
  )

  const switchWizardChannel = useCallback(
    (channel: ConnectorChannel) => {
      setWizardForm((prev) => ({
        ...prefillFormForChannel(channel, prev.targetRoleKey, prev.targetAgentId),
        telegramBotToken: prev.telegramBotToken,
      }))
    },
    [prefillFormForChannel],
  )

  const canGoNext = useMemo(() => {
    if (wizardStep === 1) {
      if (wizardForm.targetBindingType === 'role') {
        return wizardForm.targetRoleKey.trim().length > 0
      }
      return wizardForm.targetAgentId.trim().length > 0
    }
    return true
  }, [wizardForm.targetAgentId, wizardForm.targetBindingType, wizardForm.targetRoleKey, wizardStep])



  const applyWizard = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }
    const roleTarget = normalizeRoleTarget(wizardForm.targetRoleKey)
    const agentTarget = normalizeAgentTarget(wizardForm.targetAgentId)
    const targetSelector =
      wizardForm.targetBindingType === 'role' ? roleTarget : agentTarget
    const normalizedAccountId = normalizeAccountId(wizardForm.accountId)
    if (!targetSelector) {
      setErrorMessage(t(locale, 'settings.channel.wizard.error.targetRequired'))
      return
    }

    let telegramHasStoredToken = false
    if (wizardForm.channel === 'telegram') {
      try {
        const { accounts } = await desktopApi.channelConnectorAccountList('telegram')
        telegramHasStoredToken = accounts.some(
          (account) =>
            account.accountId.trim().toLowerCase() === normalizedAccountId.trim().toLowerCase() &&
            account.hasBotToken,
        )
      } catch {
        telegramHasStoredToken = false
      }
      if (!telegramHasStoredToken && !wizardForm.telegramBotToken.trim()) {
        setErrorMessage(t(locale, 'settings.channel.wizard.error.telegramTokenRequired'))
        return
      }
    }

    setSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      if (wizardForm.channel === 'telegram') {
        await desktopApi.channelConnectorAccountUpsert({
          channel: 'telegram',
          accountId: normalizedAccountId,
          enabled: true,
          mode: 'polling',
          botToken: wizardForm.telegramBotToken.trim() || undefined,
        })
      }

      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: wizardForm.channel,
        accountId: normalizedAccountId,
        peerKind: wizardForm.peerKind,
        peerPattern: wizardForm.peerPattern.trim() || null,
        targetAgentId: targetSelector,
        priority: Number.isFinite(wizardForm.priority) ? Math.floor(wizardForm.priority) : 100,
      })

      await desktopApi.channelAccessPolicySet(
        wizardForm.channel,
        wizardForm.policyMode,
        normalizedAccountId,
      )

      const identities = parseIdentities(wizardForm.approveIdentities)
      for (const identity of identities) {
        await desktopApi.channelAccessApprove(wizardForm.channel, identity, normalizedAccountId)
      }

      let telegramPostCheckWarning: string | null = null
      if (wizardForm.channel === 'telegram') {
        try {
          await desktopApi.channelConnectorHealth('telegram', normalizedAccountId)
        } catch (error) {
          const healthError = describeError(error)
          telegramPostCheckWarning = telegramPostCheckWarning
            ? `${telegramPostCheckWarning}; ${healthError}`
            : healthError
        }
      }

      await Promise.all([loadBindingsAndRoles(), loadRuntimeStatus(), loadWizardAccessEntries()])

      setWizardOpen(false)
      setWizardStep(0)
      if (telegramPostCheckWarning) {
        setStatusMessage(
          t(
            locale,
            '{channel} 通道已保存，但后置检查未通过: {detail}',
            '{channel} channel setup saved, but post-check failed: {detail}',
            {
              channel: channelLabel(locale, wizardForm.channel),
              detail: telegramPostCheckWarning,
            },
          ),
        )
      } else {
        setStatusMessage(
          t(locale, '{channel} 通道已配置完成。', '{channel} channel setup completed.', {
            channel: channelLabel(locale, wizardForm.channel),
          }),
        )
      }
    } catch (error) {
      setErrorMessage(
        t(locale, '通道配置失败: {detail}', 'Channel setup failed: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setSaving(false)
    }
  }, [
    loadBindingsAndRoles,
    loadRuntimeStatus,
    loadWizardAccessEntries,
    locale,
    wizardForm,
    workspaceId,
  ])

  const handleCopy = useCallback(
    async (value: string) => {
      const ok = await copyTextToClipboard(value)
      if (ok) {
        setStatusMessage(t(locale, '地址已复制。', 'Address copied.'))
      } else {
        setErrorMessage(t(locale, '复制失败，请手动复制。', 'Copy failed. Please copy manually.'))
      }
    },
    [locale],
  )

  const disabled = loading || saving
  const telegramBotToken = wizardForm.telegramBotToken.trim()
  const telegramSetWebhookUrl =
    currentWebhook && telegramBotToken
      ? `https://api.telegram.org/bot${telegramBotToken}/setWebhook?url=${encodeURIComponent(currentWebhook)}`
      : 'https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=<telegram_webhook>'
  const telegramGetWebhookInfoUrl = telegramBotToken
    ? `https://api.telegram.org/bot${telegramBotToken}/getWebhookInfo`
    : 'https://api.telegram.org/bot<telegram_bot_token>/getWebhookInfo'
  const selectedRoleLabel =
    (roleLabelByKey.get(wizardForm.targetRoleKey) ?? wizardForm.targetRoleKey).trim() || '-'
  const selectedAgentLabel =
    (agentLabelById.get(wizardForm.targetAgentId) ?? wizardForm.targetAgentId).trim() || '-'
  const reviewTargetLabel =
    wizardForm.targetBindingType === 'role' ? selectedRoleLabel : selectedAgentLabel

  return (
    <section className="settings-channel-pane" aria-label={t(locale, '外部通道接入', 'External Channels')}>
      {!wizardOpen ? (
        <>
          <header className="settings-channel-header">
            <div>
          <h3>{t(locale, '通道连接管理', 'Channel Connection Management')}</h3>
          <p>
            {t(
              locale,
              '默认仅显示已添加的 Channel。点击“添加 Channel”使用分步向导配置并绑定目标（Agent/岗位）。',
              'Only added channels are shown by default. Click "Add Channel" to configure and bind target (agent/role).',
            )}
          </p>
        </div>
        <div className="settings-channel-header-actions">
          <span className={`settings-channel-runtime-pill ${runtimeRunning ? 'running' : 'stopped'}`}>
            {runtimeRunning ? t(locale, '运行中', 'Running') : t(locale, '未就绪', 'Not Ready')}
          </span>
          <button type="button" className="settings-channel-add-btn" onClick={() => openWizard()} disabled={disabled}>
            {t(locale, '添加 Channel', 'Add Channel')}
          </button>
        </div>
      </header>



      {bindings.length === 0 ? (
        <>
          <p className="settings-channel-hint settings-channel-empty">
            {t(
              locale,
              '当前没有已添加的 Channel。点击右上角“添加 Channel”开始配置。',
              'No channels added yet. Click "Add Channel" to start setup.',
            )}
          </p>
          <p className="settings-channel-hint">
            {t(
              locale,
              '注意：仅保存机器人 token 不会自动派发消息；必须至少添加一条 Channel 路由绑定。',
              'Note: Saving bot token alone does not dispatch messages. Add at least one channel route binding.',
            )}
          </p>
        </>
      ) : null}
      {bindings.length > 0 ? (
        <ul className="settings-channel-binding-list">
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
                <li key={`${item.channel}:${item.accountId ?? 'default'}:${item.peerPattern ?? '*'}:${item.targetAgentId}`}>
                  <strong>{item.channel}</strong>
                  <span>{item.accountId ?? 'default'}</span>
                  <span>{item.peerKind ?? '*'}</span>
                  <span>{item.peerPattern ?? '*'}</span>
                  <span>{targetLabel}</span>
                  <span>{item.priority ?? 0}</span>
                  <div className="settings-channel-wizard-inline-actions" style={{ marginTop: 0, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => editBinding(item)} disabled={loading || saving} style={{ padding: '2px 8px' }}>
                      {t(locale, '编辑', 'Edit')}
                    </button>
                    <button type="button" onClick={() => void deleteBinding(item)} disabled={loading || saving} style={{ padding: '2px 8px', color: '#b24b32', borderColor: '#b24b3255' }}>
                      {t(locale, '删除', 'Delete')}
                    </button>
                  </div>
                </li>
              )
            })}
        </ul>
      ) : null}

          {statusMessage ? <p className="settings-channel-message">{statusMessage}</p> : null}
          {errorMessage ? <p className="settings-channel-error">{errorMessage}</p> : null}
        </>
      ) : null}

      {wizardOpen ? (
        <div className="settings-channel-wizard-inline">
            <header className="settings-channel-wizard-header">
              <div>
                <h4>{t(locale, '添加 Channel 向导', 'Add Channel Wizard')}</h4>
                <p>{t(locale, 'Step {step}/{total}', 'Step {step}/{total}', { step: wizardStep + 1, total: WIZARD_STEP_COUNT })}</p>
              </div>
              <button type="button" onClick={closeWizard} disabled={saving}>
                {t(locale, '关闭', 'Close')}
              </button>
            </header>

            <div className="settings-channel-wizard-steps" aria-hidden="true">
              {Array.from({ length: WIZARD_STEP_COUNT }).map((_, index) => (
                <span key={`wizard-step-${index}`} className={index <= wizardStep ? 'active' : ''} />
              ))}
            </div>

            <div className="settings-channel-wizard-body">
              {wizardStep === 0 ? (
                <div className="settings-channel-form-group">
                  <h5>{t(locale, 'Step 1 选择通道并绑定 webhook', 'Step 1 Select channel and webhook')}</h5>
                  <div className="settings-channel-segmented">
                    <button
                      type="button"
                      className={wizardForm.channel === 'telegram' ? 'active' : ''}
                      onClick={() => switchWizardChannel('telegram')}
                      disabled={saving}
                    >
                      Telegram
                    </button>
                    <button
                      type="button"
                      className={wizardForm.channel === 'feishu' ? 'active' : ''}
                      onClick={() => switchWizardChannel('feishu')}
                      disabled={saving}
                    >
                      {t(locale, '飞书', 'Feishu')}
                    </button>
                  </div>
                  <label>
                    {t(locale, '回调地址', 'Webhook URL')}
                    <div className="settings-channel-code-row">
                      <code>{currentWebhook || '-'}</code>
                      <button type="button" disabled={!currentWebhook} onClick={() => void handleCopy(currentWebhook)}>
                        {t(locale, '复制', 'Copy')}
                      </button>
                    </div>
                  </label>
                  <label>
                    Account ID
                    <input
                      type="text"
                      value={wizardForm.accountId}
                      disabled={saving}
                      placeholder="default"
                      onChange={(event) => updateWizardField('accountId', event.target.value)}
                    />
                  </label>
                  {wizardForm.channel === 'telegram' ? (
                    <>
                      <label>
                        {t(locale, 'Telegram Bot Token（来自 BotFather）', 'Telegram Bot Token (from BotFather)')}
                        <input
                          type="password"
                          value={wizardForm.telegramBotToken}
                          disabled={saving}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t(locale, '粘贴 Telegram Bot Token', 'Paste Telegram Bot Token')}
                          onChange={(event) => updateWizardField('telegramBotToken', event.target.value)}
                          className="settings-channel-standalone-input"
                        />
                      </label>
                      <label>
                        {t(locale, 'Telegram setWebhook 地址', 'Telegram setWebhook URL')}
                        <div className="settings-channel-code-row">
                          <code>{telegramSetWebhookUrl}</code>
                          <button type="button" disabled={!telegramBotToken || !currentWebhook} onClick={() => void handleCopy(telegramSetWebhookUrl)}>
                            {t(locale, '复制', 'Copy')}
                          </button>
                        </div>
                      </label>
                      <label>
                        {t(locale, '健康检查地址（openclaw 风格）', 'Health check URL (openclaw style)')}
                        <div className="settings-channel-code-row">
                          <code>{telegramGetWebhookInfoUrl}</code>
                          <button type="button" disabled={!telegramBotToken} onClick={() => void handleCopy(telegramGetWebhookInfoUrl)}>
                            {t(locale, '复制', 'Copy')}
                          </button>
                        </div>
                      </label>
                      <p className="settings-channel-hint">
                        {t(
                          locale,
                          '提示：webhook URL 最后一段 token 是 GT Office 生成的通道密钥，不是 Telegram Bot Token。',
                          'Note: the trailing token in webhook URL is GT Office channel secret, not Telegram Bot Token.',
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="settings-channel-hint">
                      {t(
                        locale,
                        '飞书配置后会先触发 url_verification，需返回 challenge；再发送测试消息确认入站。',
                        'Feishu triggers url_verification first. Return challenge, then send a test message.',
                      )}
                    </p>
                  )}
                </div>
              ) : null}

              {wizardStep === 1 ? (
                <div className="settings-channel-form-group">
                  <h5>{t(locale, 'settings.channel.wizard.step2.title')}</h5>
                  <p className="settings-channel-hint">
                    {workspaceBound
                      ? t(locale, '当前工作区: {id}', 'Current workspace: {id}', { id: workspaceId ?? '' })
                      : t(locale, '未绑定工作区，仍可填写；应用时会校验。', 'Workspace is not bound yet. Apply will validate.')}
                  </p>
                  <div className="settings-channel-segmented">
                    <button
                      type="button"
                      className={wizardForm.targetBindingType === 'agent' ? 'active' : ''}
                      onClick={() => updateWizardField('targetBindingType', 'agent')}
                      disabled={saving}
                    >
                      {t(locale, 'settings.channel.wizard.step2.bindAgent')}
                    </button>
                    <button
                      type="button"
                      className={wizardForm.targetBindingType === 'role' ? 'active' : ''}
                      onClick={() => updateWizardField('targetBindingType', 'role')}
                      disabled={saving}
                    >
                      {t(locale, 'settings.channel.wizard.step2.bindRole')}
                    </button>
                  </div>
                  <div className="settings-channel-form-grid">
                    <label>
                      {t(locale, '会话类型', 'Peer Kind')}
                      <select
                        value={wizardForm.peerKind}
                        disabled={saving}
                        onChange={(event) => updateWizardField('peerKind', event.target.value as 'direct' | 'group')}
                      >
                        <option value="direct">Direct</option>
                        <option value="group">Group</option>
                      </select>
                    </label>
                    <label>
                      {t(locale, 'Peer Pattern（可选）', 'Peer Pattern (optional)')}
                      <input
                        type="text"
                        value={wizardForm.peerPattern}
                        disabled={saving}
                        onChange={(event) => updateWizardField('peerPattern', event.target.value)}
                      />
                    </label>
                    {wizardForm.targetBindingType === 'role' ? (
                      <>
                        <label>
                          {t(locale, 'settings.channel.wizard.step2.roleSelect')}
                          <select
                            value={wizardForm.targetRoleKey}
                            disabled={saving || activeRoles.length === 0}
                            onChange={(event) => updateWizardField('targetRoleKey', event.target.value)}
                          >
                            {activeRoles.length === 0 ? (
                              <option value="">{t(locale, 'settings.channel.wizard.step2.emptyRole')}</option>
                            ) : null}
                            {activeRoles.map((role) => (
                              <option key={role.id} value={role.roleKey}>
                                {role.roleName} ({role.roleKey})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t(locale, 'settings.channel.wizard.step2.roleManual')}
                          <input
                            type="text"
                            value={wizardForm.targetRoleKey}
                            disabled={saving}
                            placeholder={t(locale, 'settings.channel.wizard.step2.rolePlaceholder')}
                            onChange={(event) => updateWizardField('targetRoleKey', event.target.value)}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label>
                          {t(locale, 'settings.channel.wizard.step2.agentSelect')}
                          <select
                            value={wizardForm.targetAgentId}
                            disabled={saving || activeAgents.length === 0}
                            onChange={(event) => updateWizardField('targetAgentId', event.target.value)}
                          >
                            {activeAgents.length === 0 ? (
                              <option value="">{t(locale, 'settings.channel.wizard.step2.emptyAgent')}</option>
                            ) : null}
                            {activeAgents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agentLabelById.get(agent.id) ?? `${agent.name} (${agent.id})`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t(locale, 'settings.channel.wizard.step2.agentManual')}
                          <input
                            type="text"
                            value={wizardForm.targetAgentId}
                            disabled={saving}
                            placeholder={t(locale, 'settings.channel.wizard.step2.agentPlaceholder')}
                            onChange={(event) => updateWizardField('targetAgentId', event.target.value)}
                          />
                        </label>
                      </>
                    )}
                    <label>
                      {t(locale, '优先级', 'Priority')}
                      <input
                        type="number"
                        value={wizardForm.priority}
                        disabled={saving}
                        onChange={(event) => updateWizardField('priority', Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <div className="settings-channel-wizard-inline-actions">
                    <button type="button" disabled={saving} onClick={() => void loadBindingsAndRoles()}>
                      {t(locale, 'settings.channel.wizard.step2.refreshTargets')}
                    </button>
                    <span>
                      {wizardForm.targetBindingType === 'role'
                        ? activeRoles.length > 0
                          ? t(locale, 'settings.channel.wizard.step2.roleCount', { count: activeRoles.length })
                          : t(locale, 'settings.channel.wizard.step2.roleEmptyHint')
                        : activeAgents.length > 0
                          ? t(locale, 'settings.channel.wizard.step2.agentCount', {
                              count: activeAgents.length,
                            })
                          : t(locale, 'settings.channel.wizard.step2.agentEmptyHint')}
                    </span>
                  </div>
                </div>
              ) : null}

              {wizardStep === 2 ? (
                <div className="settings-channel-form-group">
                  <h5>{t(locale, 'Step 3 准入策略与授权', 'Step 3 Access policy & approvals')}</h5>
                  <div className="settings-channel-form-grid">
                    <label>
                      {t(locale, '策略模式', 'Policy Mode')}
                      <select
                        value={wizardForm.policyMode}
                        disabled={saving}
                        onChange={(event) => updateWizardField('policyMode', event.target.value as ExternalAccessPolicyMode)}
                      >
                        <option value="pairing">pairing</option>
                        <option value="allowlist">allowlist</option>
                        <option value="open">open</option>
                        <option value="disabled">disabled</option>
                      </select>
                    </label>
                    <label>
                      {t(locale, '预授权 identities（可选）', 'Pre-approve identities (optional)')}
                      <textarea
                        rows={4}
                        value={wizardForm.approveIdentities}
                        disabled={saving}
                        placeholder={t(locale, '每行一个，或逗号分隔', 'One per line, or comma-separated')}
                        onChange={(event) => updateWizardField('approveIdentities', event.target.value)}
                      />
                    </label>
                  </div>
                  {wizardAccessEntries.length > 0 ? (
                    <ul className="settings-channel-access-list">
                      {wizardAccessEntries.map((entry) => (
                        <li key={`${entry.channel}:${entry.accountId}:${entry.identity}`}>
                          <strong>{entry.identity}</strong>
                          <span>{entry.accountId}</span>
                          <span>{entry.approved ? 'approved' : 'pending'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="settings-channel-hint">
                      {t(locale, '当前 account 下暂无已授权 identity。', 'No approved identities under current account yet.')}
                    </p>
                  )}
                </div>
              ) : null}

              {wizardStep === 3 ? (
                <div className="settings-channel-form-group">
                  <h5>{t(locale, 'Step 4 确认并应用', 'Step 4 Review and apply')}</h5>
                  <ul className="settings-channel-review-list">
                    <li>
                      <span>{t(locale, '通道', 'Channel')}</span>
                      <strong>{channelLabel(locale, wizardForm.channel)}</strong>
                    </li>
                    <li>
                      <span>Account ID</span>
                      <strong>{normalizeAccountId(wizardForm.accountId)}</strong>
                    </li>
                    <li>
                      <span>{t(locale, 'settings.channel.wizard.step2.targetType')}</span>
                      <strong>
                        {wizardForm.targetBindingType === 'role'
                          ? t(locale, 'settings.channel.wizard.step2.bindRole')
                          : t(locale, 'settings.channel.wizard.step2.bindAgent')}
                      </strong>
                    </li>
                    <li>
                      <span>{t(locale, 'settings.channel.wizard.step2.targetValue')}</span>
                      <strong>{reviewTargetLabel}</strong>
                    </li>
                    <li>
                      <span>{t(locale, '会话匹配', 'Peer Match')}</span>
                      <strong>{wizardForm.peerKind} / {wizardForm.peerPattern.trim() || '*'}</strong>
                    </li>
                    <li>
                      <span>{t(locale, '准入策略', 'Policy')}</span>
                      <strong>{wizardForm.policyMode}</strong>
                    </li>
                    <li>
                      <span>{t(locale, '预授权数量', 'Pre-approvals')}</span>
                      <strong>{parseIdentities(wizardForm.approveIdentities).length}</strong>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>

            <footer className="settings-channel-wizard-footer">
              <button
                type="button"
                onClick={() => setWizardStep((prev) => Math.max(0, prev - 1))}
                disabled={saving || wizardStep === 0}
              >
                {t(locale, '上一步', 'Previous')}
              </button>
              {wizardStep < WIZARD_STEP_COUNT - 1 ? (
                <button
                  type="button"
                  onClick={() => setWizardStep((prev) => Math.min(WIZARD_STEP_COUNT - 1, prev + 1))}
                  disabled={saving || !canGoNext}
                >
                  {t(locale, '下一步', 'Next')}
                </button>
              ) : (
                <button type="button" className="settings-channel-add-btn" onClick={() => void applyWizard()} disabled={saving}>
                  {saving ? t(locale, '应用中...', 'Applying...') : t(locale, '应用配置', 'Apply Configuration')}
                </button>
              )}
            </footer>
        </div>
      ) : null}
    </section>
  )
}
