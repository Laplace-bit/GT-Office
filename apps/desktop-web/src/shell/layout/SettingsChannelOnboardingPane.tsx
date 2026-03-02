import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  desktopApi,
  type AgentRole,
  type ChannelConnectorAccount,
  type ChannelConnectorHealthResponse,
  type ChannelRouteBinding,
  type ExternalAccessPolicyMode,
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'

type ConnectorChannel = 'feishu' | 'telegram'

type RuntimeMetrics = {
  totalRequests: number
  webhookRequests: number
  dispatched: number
  duplicate: number
  denied: number
  routeNotFound: number
  failed: number
  unauthorized: number
  rateLimited: number
  timeouts: number
  internalErrors: number
  lastError?: string | null
  lastErrorAtMs?: number | null
}

interface SettingsChannelOnboardingPaneProps {
  locale: Locale
  workspaceId: string | null
}

interface WizardForm {
  channel: ConnectorChannel
  accountId: string
  peerKind: 'direct' | 'group'
  peerPattern: string
  targetRoleKey: string
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
  targetRoleKey: '',
  telegramBotToken: '',
  priority: 100,
  policyMode: 'pairing',
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

function formatTimestamp(value: number, locale: Locale): string {
  const languageTag = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(languageTag, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
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
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState('')
  const [feishuWebhook, setFeishuWebhook] = useState('')
  const [telegramWebhook, setTelegramWebhook] = useState('')
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null)

  const [roles, setRoles] = useState<AgentRole[]>([])
  const [bindings, setBindings] = useState<ChannelRouteBinding[]>([])
  const [botConfigChannel, setBotConfigChannel] = useState<ConnectorChannel>('telegram')
  const [botConfigAccountId, setBotConfigAccountId] = useState('default')
  const [botConfigToken, setBotConfigToken] = useState('')
  const [botConfigWebhookUrl, setBotConfigWebhookUrl] = useState('')
  const [botConfigSaving, setBotConfigSaving] = useState(false)
  const [botConfigStatusMessage, setBotConfigStatusMessage] = useState<string | null>(null)
  const [botConfigErrorMessage, setBotConfigErrorMessage] = useState<string | null>(null)
  const [telegramConnectorAccounts, setTelegramConnectorAccounts] = useState<ChannelConnectorAccount[]>([])
  const [telegramHealthSnapshot, setTelegramHealthSnapshot] =
    useState<ChannelConnectorHealthResponse['health'] | null>(null)

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

  const roleLabelByKey = useMemo(() => {
    const map = new Map<string, string>()
    activeRoles.forEach((role) => {
      map.set(role.roleKey, role.roleName)
      map.set(role.id, role.roleName)
    })
    return map
  }, [activeRoles])

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
    (channel: ConnectorChannel, fallbackRoleKey?: string): WizardForm => {
      const preferred = (channelBindingsMap.get(channel) ?? [])[0]
      const preferredRole = preferred ? parseRoleTarget(preferred.targetAgentId) : ''
      const defaultRole = fallbackRoleKey ?? activeRoles[0]?.roleKey ?? ''
      return {
        channel,
        accountId: preferred?.accountId ?? 'default',
        peerKind: preferred?.peerKind ?? 'direct',
        peerPattern: preferred?.peerPattern ?? '',
        targetRoleKey: preferredRole || defaultRole,
        telegramBotToken: '',
        priority: preferred?.priority ?? 100,
        policyMode: 'pairing',
        approveIdentities: '',
      }
    },
    [activeRoles, channelBindingsMap],
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
      setRuntimeBaseUrl(runtime?.baseUrl ?? '')
      setFeishuWebhook(runtime?.feishuWebhook ?? '')
      setTelegramWebhook(runtime?.telegramWebhook ?? '')
      setRuntimeMetrics(runtime?.metrics ?? null)
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
    } else {
      setRoles([])
    }

    try {
      await Promise.all(tasks)
    } catch {
      // Best effort loading for setup UX.
    }
  }, [workspaceId])

  const loadTelegramConnectorAccounts = useCallback(
    async (reportError = false) => {
      if (!desktopApi.isTauriRuntime()) {
        setTelegramConnectorAccounts([])
        return
      }
      try {
        const response = await desktopApi.channelConnectorAccountList('telegram')
        setTelegramConnectorAccounts(response.accounts)
        setBotConfigAccountId((previous) => {
          const normalized = normalizeAccountId(previous)
          const exists = response.accounts.some(
            (account) => normalizeAccountId(account.accountId) === normalized,
          )
          if (exists) {
            return normalized
          }
          return response.accounts[0]?.accountId ?? 'default'
        })
      } catch (error) {
        setTelegramConnectorAccounts([])
        if (reportError) {
          setBotConfigErrorMessage(
            t(locale, '读取机器人账户失败: {detail}', 'Failed to load bot accounts: {detail}', {
              detail: describeError(error),
            }),
          )
        }
      }
    },
    [locale],
  )

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
    void loadTelegramConnectorAccounts()
  }, [loadTelegramConnectorAccounts])

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
    if (!wizardOpen || wizardForm.targetRoleKey.trim().length > 0 || activeRoles.length === 0) {
      return
    }
    setWizardForm((prev) => ({
      ...prev,
      targetRoleKey: activeRoles[0]?.roleKey ?? '',
    }))
  }, [activeRoles, wizardForm.targetRoleKey, wizardOpen])

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
        ...prefillFormForChannel(channel, prev.targetRoleKey),
        telegramBotToken: prev.telegramBotToken,
      }))
    },
    [prefillFormForChannel],
  )

  const canGoNext = useMemo(() => {
    if (wizardStep === 1) {
      return wizardForm.targetRoleKey.trim().length > 0
    }
    return true
  }, [wizardForm.targetRoleKey, wizardStep])

  const saveTelegramBotConfig = useCallback(async () => {
    const accountId = normalizeAccountId(botConfigAccountId)
    const token = botConfigToken.trim()
    if (!token) {
      setBotConfigErrorMessage(
        t(locale, '请输入 Telegram Bot Token。', 'Enter Telegram bot token first.'),
      )
      return
    }
    setBotConfigSaving(true)
    setBotConfigStatusMessage(null)
    setBotConfigErrorMessage(null)
    try {
      await desktopApi.channelConnectorAccountUpsert({
        channel: 'telegram',
        accountId,
        enabled: true,
        mode: 'polling',
        botToken: token,
      })
      await loadTelegramConnectorAccounts()
      setBotConfigStatusMessage(
        t(locale, 'Telegram 机器人配置已保存。', 'Telegram bot configuration saved.'),
      )
    } catch (error) {
      setBotConfigErrorMessage(
        t(locale, '保存 Telegram 机器人失败: {detail}', 'Failed to save Telegram bot: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setBotConfigSaving(false)
    }
  }, [botConfigAccountId, botConfigToken, loadTelegramConnectorAccounts, locale])

  const runTelegramHealthCheck = useCallback(async () => {
    const accountId = normalizeAccountId(botConfigAccountId)
    setBotConfigSaving(true)
    setBotConfigStatusMessage(null)
    setBotConfigErrorMessage(null)
    try {
      const response = await desktopApi.channelConnectorHealth('telegram', accountId)
      setTelegramHealthSnapshot(response.health)
      setBotConfigStatusMessage(
        t(locale, '健康检查完成，状态: {status}', 'Health check completed. Status: {status}', {
          status: response.health.status,
        }),
      )
    } catch (error) {
      setBotConfigErrorMessage(
        t(locale, 'Telegram 健康检查失败: {detail}', 'Telegram health check failed: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setBotConfigSaving(false)
    }
  }, [botConfigAccountId, locale])

  const syncTelegramWebhook = useCallback(async () => {
    const accountId = normalizeAccountId(botConfigAccountId)
    const webhookUrl = botConfigWebhookUrl.trim()
    if (!webhookUrl) {
      setBotConfigErrorMessage(null)
      setBotConfigStatusMessage(
        t(
          locale,
          '当前为 polling 模式，未填写公网 HTTPS Webhook URL 时无需同步。',
          'Polling mode is active. Webhook sync is not required unless you provide a public HTTPS webhook URL.',
        ),
      )
      return
    }
    if (!/^https:\/\//i.test(webhookUrl)) {
      setBotConfigErrorMessage(
        t(
          locale,
          'Telegram setWebhook 仅接受 HTTPS 公网地址。请在“公网 Webhook URL”填写隧道/反代后的 HTTPS 地址。',
          'Telegram setWebhook requires a public HTTPS URL. Fill "Public Webhook URL" with your tunnel/reverse-proxy HTTPS endpoint.',
        ),
      )
      return
    }
    setBotConfigSaving(true)
    setBotConfigStatusMessage(null)
    setBotConfigErrorMessage(null)
    try {
      const response = await desktopApi.channelConnectorWebhookSync('telegram', accountId, webhookUrl)
      setBotConfigStatusMessage(
        t(
          locale,
          'Webhook 同步完成: {detail}',
          'Webhook sync completed: {detail}',
          { detail: response.result.detail },
        ),
      )
      const health = await desktopApi.channelConnectorHealth('telegram', accountId)
      setTelegramHealthSnapshot(health.health)
      await loadRuntimeStatus()
    } catch (error) {
      setBotConfigErrorMessage(
        t(locale, '同步 Telegram webhook 失败: {detail}', 'Failed to sync Telegram webhook: {detail}', {
          detail: describeError(error),
        }),
      )
    } finally {
      setBotConfigSaving(false)
    }
  }, [botConfigAccountId, botConfigWebhookUrl, loadRuntimeStatus, locale, telegramWebhook])

  const applyWizard = useCallback(async () => {
    if (!desktopApi.isTauriRuntime()) {
      return
    }
    if (!workspaceId) {
      setErrorMessage(t(locale, '请先绑定工作区。', 'Bind a workspace first.'))
      return
    }
    if (!wizardForm.targetRoleKey.trim()) {
      setErrorMessage(t(locale, '请选择岗位。', 'Select a role first.'))
      return
    }

    const targetRoleSelector = normalizeRoleTarget(wizardForm.targetRoleKey)
    if (!targetRoleSelector) {
      setErrorMessage(t(locale, '岗位不能为空。', 'Role cannot be empty.'))
      return
    }
    if (wizardForm.channel === 'telegram' && !wizardForm.telegramBotToken.trim()) {
      setErrorMessage(t(locale, '请输入 Telegram Bot Token。', 'Enter Telegram bot token first.'))
      return
    }

    setSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const normalizedAccountId = normalizeAccountId(wizardForm.accountId)
      if (wizardForm.channel === 'telegram') {
        await desktopApi.channelConnectorAccountUpsert({
          channel: 'telegram',
          accountId: normalizedAccountId,
          enabled: true,
          mode: 'polling',
          botToken: wizardForm.telegramBotToken.trim(),
        })
      }

      await desktopApi.channelBindingUpsert({
        workspaceId,
        channel: wizardForm.channel,
        accountId: normalizedAccountId,
        peerKind: wizardForm.peerKind,
        peerPattern: wizardForm.peerPattern.trim() || null,
        targetAgentId: targetRoleSelector,
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

  const disabled = loading || saving || botConfigSaving
  const telegramBotToken = wizardForm.telegramBotToken.trim()
  const telegramSetWebhookUrl =
    currentWebhook && telegramBotToken
      ? `https://api.telegram.org/bot${telegramBotToken}/setWebhook?url=${encodeURIComponent(currentWebhook)}`
      : 'https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=<telegram_webhook>'
  const telegramGetWebhookInfoUrl = telegramBotToken
    ? `https://api.telegram.org/bot${telegramBotToken}/getWebhookInfo`
    : 'https://api.telegram.org/bot<telegram_bot_token>/getWebhookInfo'

  return (
    <section className="settings-channel-pane" aria-label={t(locale, '外部通道接入', 'External Channels')}>
      <header className="settings-channel-header">
        <div>
          <h3>{t(locale, '通道连接管理', 'Channel Connection Management')}</h3>
          <p>
            {t(
              locale,
              '默认仅显示已添加的 Channel。点击“添加 Channel”使用分步向导配置并绑定岗位。',
              'Only added channels are shown by default. Click "Add Channel" to configure and bind role via wizard.',
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

      <div className="settings-channel-form-group">
        <header>
          <div>
            <h4>{t(locale, '机器人配置', 'Bot Configuration')}</h4>
            <p className="settings-channel-hint">
              {t(
                locale,
                '默认使用 polling 模式（无需公网 webhook），可按需手动同步 webhook。',
                'Polling mode is default (no public webhook required). Webhook sync is optional.',
              )}
            </p>
          </div>
          <div className="settings-channel-segmented" role="tablist" aria-label="channel bot selector">
            <button
              type="button"
              className={botConfigChannel === 'telegram' ? 'active' : ''}
              onClick={() => setBotConfigChannel('telegram')}
              disabled={disabled}
            >
              Telegram
            </button>
            <button
              type="button"
              className={botConfigChannel === 'feishu' ? 'active' : ''}
              onClick={() => setBotConfigChannel('feishu')}
              disabled={disabled}
            >
              {t(locale, '飞书', 'Feishu')}
            </button>
          </div>
        </header>

        {botConfigChannel === 'telegram' ? (
          <>
            <div className="settings-channel-form-grid">
              <label>
                Account ID
                <input
                  type="text"
                  value={botConfigAccountId}
                  disabled={disabled}
                  onChange={(event) => setBotConfigAccountId(event.target.value)}
                />
              </label>
              <label>
                {t(locale, 'Telegram Bot Token', 'Telegram Bot Token')}
                <input
                  type="password"
                  value={botConfigToken}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(locale, '粘贴 BotFather 生成的 token', 'Paste token from BotFather')}
                  onChange={(event) => setBotConfigToken(event.target.value)}
                />
              </label>
              <label>
                {t(locale, '公网 Webhook URL（可选）', 'Public Webhook URL (optional)')}
                <input
                  type="text"
                  value={botConfigWebhookUrl}
                  disabled={disabled}
                  spellCheck={false}
                  placeholder={t(
                    locale,
                    'https://your-domain/webhook/telegram/<token>',
                    'https://your-domain/webhook/telegram/<token>',
                  )}
                  onChange={(event) => setBotConfigWebhookUrl(event.target.value)}
                />
              </label>
            </div>

            <p className="settings-channel-hint">
              {t(
                locale,
                '日常建议直接使用 polling（只保存 token 即可）。仅当你需要 Telegram 主动回调时，再填写公网 HTTPS webhook 地址并执行同步。',
                'Use polling for daily setup (token only). Configure and sync a public HTTPS webhook URL only if you need Telegram callback mode.',
              )}
            </p>

            <div className="settings-channel-wizard-inline-actions">
              <button type="button" disabled={disabled} onClick={() => void saveTelegramBotConfig()}>
                {t(locale, '保存机器人', 'Save Bot')}
              </button>
              <button type="button" disabled={disabled} onClick={() => void syncTelegramWebhook()}>
                {t(locale, '同步 Webhook（高级）', 'Sync Webhook (Advanced)')}
              </button>
              <button type="button" disabled={disabled} onClick={() => void runTelegramHealthCheck()}>
                {t(locale, '健康检查', 'Health Check')}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  void loadTelegramConnectorAccounts(true)
                }}
              >
                {t(locale, '刷新账户', 'Refresh Accounts')}
              </button>
            </div>

            {telegramConnectorAccounts.length > 0 ? (
              <ul className="settings-channel-review-list">
                {telegramConnectorAccounts.map((account) => (
                  <li key={account.accountId}>
                    <span>
                      {account.accountId} · {account.enabled ? 'enabled' : 'disabled'}
                    </span>
                    <strong>
                      {account.hasBotToken
                        ? t(locale, 'Token 已保存', 'Token saved')
                        : t(locale, 'Token 缺失', 'Token missing')}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="settings-channel-hint">
                {t(locale, '暂无 Telegram 机器人账户。', 'No Telegram bot accounts yet.')}
              </p>
            )}

            {telegramHealthSnapshot ? (
              <ul className="settings-channel-review-list">
                <li>
                  <span>{t(locale, '最近健康状态', 'Latest Health Status')}</span>
                  <strong>
                    {telegramHealthSnapshot.status} / {telegramHealthSnapshot.ok ? 'ok' : 'failed'}
                  </strong>
                </li>
                <li>
                  <span>{t(locale, 'Bot 用户名', 'Bot Username')}</span>
                  <strong>{telegramHealthSnapshot.botUsername ?? '-'}</strong>
                </li>
                <li>
                  <span>{t(locale, 'Webhook 对齐', 'Webhook Matched')}</span>
                  <strong>
                    {telegramHealthSnapshot.webhookMatched === null
                      ? '-'
                      : telegramHealthSnapshot.webhookMatched
                        ? 'true'
                        : 'false'}
                  </strong>
                </li>
                <li>
                  <span>{t(locale, '检查时间', 'Checked At')}</span>
                  <strong>{formatTimestamp(telegramHealthSnapshot.checkedAtMs, locale)}</strong>
                </li>
              </ul>
            ) : null}
          </>
        ) : (
          <p className="settings-channel-hint">
            {t(
              locale,
              'Feishu connector 机器人配置将在后续版本提供；当前请先使用回调地址完成平台侧 webhook 绑定。',
              'Feishu connector bot configuration will be added in a later version. For now, use the callback URL to finish webhook binding on Feishu.',
            )}
          </p>
        )}

        {botConfigStatusMessage ? <p className="settings-channel-message">{botConfigStatusMessage}</p> : null}
        {botConfigErrorMessage ? <p className="settings-channel-error">{botConfigErrorMessage}</p> : null}
      </div>

      {addedChannels.length > 0 ? (
        <div className="settings-channel-card-grid">
          {addedChannels.map((channel) => {
            const bindingCount = channelBindingsMap.get(channel)?.length ?? 0
            const webhook = channel === 'telegram' ? telegramWebhook : feishuWebhook
            return (
              <article key={channel} className="settings-channel-card">
                <h4>{channelLabel(locale, channel)}</h4>
                <p>{t(locale, '绑定数: {count}', 'Bindings: {count}', { count: bindingCount })}</p>
                <code>{webhook || '-'}</code>
                <button type="button" onClick={() => openWizard(channel)} disabled={disabled}>
                  {t(locale, '配置向导', 'Open Wizard')}
                </button>
              </article>
            )
          })}
        </div>
      ) : (
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
      )}

      <div className="settings-channel-endpoints settings-channel-endpoints-compact">
        <p>
          <strong>Base URL</strong>
          <code>{runtimeBaseUrl || '-'}</code>
          <button type="button" disabled={!runtimeBaseUrl} onClick={() => void handleCopy(runtimeBaseUrl)}>
            {t(locale, '复制', 'Copy')}
          </button>
        </p>
        <p className="settings-channel-hint">
          {t(
            locale,
            'Base URL 是本机通道接收地址（用于拼接 Telegram/飞书 webhook 回调），不是 Telegram Bot API 地址。',
            'Base URL is the local inbound endpoint used to build webhook callbacks, not Telegram Bot API host.',
          )}
        </p>
      </div>

      {runtimeMetrics ? (
        <div className="settings-channel-metrics">
          <span>{t(locale, '总请求 {count}', 'Total {count}', { count: runtimeMetrics.totalRequests })}</span>
          <span>{t(locale, '派发 {count}', 'Dispatched {count}', { count: runtimeMetrics.dispatched })}</span>
          <span>{t(locale, '重复 {count}', 'Duplicate {count}', { count: runtimeMetrics.duplicate })}</span>
          <span>{t(locale, '401 {count}', '401 {count}', { count: runtimeMetrics.unauthorized })}</span>
          <span>{t(locale, '限流 {count}', 'Rate Limited {count}', { count: runtimeMetrics.rateLimited })}</span>
          <span>{t(locale, '超时 {count}', 'Timeout {count}', { count: runtimeMetrics.timeouts })}</span>
          <span>
            {t(locale, '内部错误 {count}', 'Internal Errors {count}', { count: runtimeMetrics.internalErrors })}
          </span>
        </div>
      ) : null}

      {bindings.length > 0 ? (
        <ul className="settings-channel-binding-list">
          {bindings
            .slice()
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .map((item) => {
              const roleKey = parseRoleTarget(item.targetAgentId)
              const roleLabel = roleKey ? roleLabelByKey.get(roleKey) ?? roleKey : item.targetAgentId
              return (
                <li key={`${item.channel}:${item.accountId ?? 'default'}:${item.peerPattern ?? '*'}:${item.targetAgentId}`}>
                  <strong>{item.channel}</strong>
                  <span>{item.accountId ?? 'default'}</span>
                  <span>{item.peerKind ?? '*'}</span>
                  <span>{item.peerPattern ?? '*'}</span>
                  <span>{roleLabel}</span>
                  <span>{item.priority ?? 0}</span>
                </li>
              )
            })}
        </ul>
      ) : null}

      {runtimeMetrics?.lastError ? (
        <p className="settings-channel-error">
          {t(locale, '最近错误: {error}', 'Last error: {error}', {
            error: runtimeMetrics.lastError,
          })}
          {runtimeMetrics.lastErrorAtMs ? ` (${formatTimestamp(runtimeMetrics.lastErrorAtMs, locale)})` : ''}
        </p>
      ) : null}

      {statusMessage ? <p className="settings-channel-message">{statusMessage}</p> : null}
      {errorMessage ? <p className="settings-channel-error">{errorMessage}</p> : null}

      {wizardOpen ? (
        <div className="settings-channel-wizard-backdrop" onClick={closeWizard}>
          <section
            className="settings-channel-wizard panel"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
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
                  <h5>{t(locale, 'Step 2 路由绑定（岗位）', 'Step 2 Route binding (Role)')}</h5>
                  <p className="settings-channel-hint">
                    {workspaceBound
                      ? t(locale, '当前工作区: {id}', 'Current workspace: {id}', { id: workspaceId ?? '' })
                      : t(locale, '未绑定工作区，仍可填写；应用时会校验。', 'Workspace is not bound yet. Apply will validate.')}
                  </p>
                  <div className="settings-channel-form-grid">
                    <label>
                      Account ID
                      <input
                        type="text"
                        value={wizardForm.accountId}
                        disabled={saving}
                        onChange={(event) => updateWizardField('accountId', event.target.value)}
                      />
                    </label>
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
                    <label>
                      {t(locale, '目标岗位', 'Target Role')}
                      <select
                        value={wizardForm.targetRoleKey}
                        disabled={saving || activeRoles.length === 0}
                        onChange={(event) => updateWizardField('targetRoleKey', event.target.value)}
                      >
                        {activeRoles.length === 0 ? <option value="">{t(locale, '暂无岗位', 'No roles')}</option> : null}
                        {activeRoles.map((role) => (
                          <option key={role.id} value={role.roleKey}>
                            {role.roleName} ({role.roleKey})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t(locale, '或手动输入岗位 key', 'Or input role key manually')}
                      <input
                        type="text"
                        value={wizardForm.targetRoleKey}
                        disabled={saving}
                        placeholder={t(locale, '例如 manager / product / build', 'e.g. manager / product / build')}
                        onChange={(event) => updateWizardField('targetRoleKey', event.target.value)}
                      />
                    </label>
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
                      {t(locale, '刷新岗位列表', 'Refresh Role List')}
                    </button>
                    <span>
                      {activeRoles.length > 0
                        ? t(locale, '已发现 {count} 个岗位', 'Found {count} roles', { count: activeRoles.length })
                        : t(locale, '未发现岗位，可手动输入 role key。', 'No roles found. Manual role key is allowed.')}
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
                      <span>{t(locale, '目标岗位', 'Target Role')}</span>
                      <strong>{roleLabelByKey.get(wizardForm.targetRoleKey) ?? (wizardForm.targetRoleKey || '-')}</strong>
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
          </section>
        </div>
      ) : null}
    </section>
  )
}
