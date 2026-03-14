import { useEffect, useState } from 'react'

import { desktopApi, type AiAgentSnapshotCard, type AiConfigPreviewResponse, type ClaudeAuthScheme, type ClaudeDraftInput, type ClaudeProviderMode, type ClaudeSnapshot } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

interface ClaudeProviderWorkspaceProps {
  locale: Locale
  workspaceId: string
  agent: AiAgentSnapshotCard
  snapshot: ClaudeSnapshot
  installing: boolean
  onInstall: () => void
  onReload: () => Promise<void>
}

const STEP_IDS = ['check', 'provider', 'guidance', 'details', 'apply'] as const

function defaultPresetId(snapshot: ClaudeSnapshot): string {
  const nonCustom = snapshot.presets.find((preset) => preset.providerId !== 'custom-gateway')
  return nonCustom?.providerId ?? snapshot.presets[0]?.providerId ?? 'anthropic-official'
}

function formatTimestamp(locale: Locale, tsMs?: number | null): string | null {
  if (!tsMs) {
    return null
  }
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(tsMs)
}

export function ClaudeProviderWorkspace({
  locale,
  workspaceId,
  agent,
  snapshot,
  installing,
  onInstall,
  onReload,
}: ClaudeProviderWorkspaceProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [mode, setMode] = useState<ClaudeProviderMode>('preset')
  const [providerId, setProviderId] = useState(defaultPresetId(snapshot))
  const [providerName, setProviderName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [authScheme, setAuthScheme] = useState<ClaudeAuthScheme>('anthropic_api_key')
  const [apiKey, setApiKey] = useState('')
  const [preview, setPreview] = useState<AiConfigPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedPreset = snapshot.presets.find((preset) => preset.providerId === providerId) ?? snapshot.presets[0]
  const currentUpdatedAt = formatTimestamp(locale, snapshot.config.updatedAtMs)
  const canInstall = !agent.installStatus.installed
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)

  function clearDerivedState() {
    setPreview(null)
    setError(null)
    setSuccess(null)
  }

  useEffect(() => {
    const nextMode = snapshot.config.activeMode ?? 'preset'
    const nextProviderId =
      snapshot.config.providerId && snapshot.presets.some((preset) => preset.providerId === snapshot.config.providerId)
        ? snapshot.config.providerId
        : defaultPresetId(snapshot)
    const nextPreset = snapshot.presets.find((preset) => preset.providerId === nextProviderId) ?? snapshot.presets[0]

    setMode(nextMode)
    setProviderId(nextProviderId)
    setProviderName(snapshot.config.providerName ?? (nextMode === 'custom' ? '' : nextPreset?.name ?? ''))
    setBaseUrl(snapshot.config.baseUrl ?? (nextPreset?.endpoint ?? ''))
    setModel(snapshot.config.model ?? (nextPreset?.recommendedModel ?? ''))
    setAuthScheme(snapshot.config.authScheme ?? (nextPreset?.authScheme ?? 'anthropic_api_key'))
    setApiKey('')
    clearDerivedState()
    setStepIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.config.activeMode, snapshot.config.providerId, snapshot.config.updatedAtMs])

  function resetPresetFields(nextProviderId: string) {
    const nextPreset = snapshot.presets.find((preset) => preset.providerId === nextProviderId)
    if (!nextPreset) {
      return
    }
    setProviderId(nextPreset.providerId)
    setProviderName(nextPreset.name)
    setBaseUrl(nextPreset.endpoint)
    setModel(nextPreset.recommendedModel)
    setAuthScheme(nextPreset.authScheme)
    clearDerivedState()
  }

  function buildDraft(): ClaudeDraftInput {
    if (mode === 'official') {
      return { mode: 'official' }
    }
    if (mode === 'custom') {
      return {
        mode: 'custom',
        providerName,
        baseUrl,
        model,
        authScheme,
        apiKey: apiKey || null,
      }
    }
    return {
      mode: 'preset',
      providerId,
      baseUrl,
      model,
      authScheme,
      apiKey: apiKey || null,
    }
  }

  async function handlePreview() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const nextPreview = await desktopApi.aiConfigPreviewPatch(workspaceId, 'claude', 'workspace', buildDraft())
      setPreview(nextPreview)
      setStepIndex(4)
    } catch (previewError) {
      setError(String(previewError))
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const ensuredPreview = preview ?? (await desktopApi.aiConfigPreviewPatch(workspaceId, 'claude', 'workspace', buildDraft()))
      if (!preview) {
        setPreview(ensuredPreview)
      }
      await desktopApi.aiConfigApplyPatch(workspaceId, ensuredPreview.previewId, 'settings-ui')
      setApiKey('')
      setSuccess(
        t(
          locale,
          'Claude 配置已应用。新的 Claude 会话启动后会自动生效。',
          'Claude settings applied. They will take effect for new Claude sessions.',
        ),
      )
      await onReload()
      setStepIndex(4)
    } catch (applyError) {
      setError(String(applyError))
    } finally {
      setLoading(false)
    }
  }

  const stepLabels = [
    t(locale, '安装检查', 'Install check'),
    t(locale, '选择供应商', 'Choose provider'),
    t(locale, '充值与 Key', 'Billing & key'),
    t(locale, '模型与高级项', 'Model & advanced'),
    t(locale, '预览并应用', 'Preview & apply'),
  ]

  return (
    <section className="ai-claude-workspace">
      <div className="ai-claude-workspace__header">
        <div>
          <h3>{t(locale, 'Claude Code 深度配置', 'Claude Code advanced setup')}</h3>
          <p>
            {t(
              locale,
              '针对 Claude 做完整供应商切换、模型覆盖和 API Key 托管。密钥仅进入系统凭据库，不写入工作区明文文件。',
              'Claude supports provider switching, model override, and API key vaulting. Secrets stay in the system credential store and are never written to workspace files.',
            )}
          </p>
        </div>
        <div className="ai-provider-surface-block ai-provider-surface-block--compact">
          <span className="ai-provider-surface-block__label">{t(locale, '当前生效配置', 'Current effective setup')}</span>
          <strong>{snapshot.config.providerName ?? t(locale, '尚未配置', 'Not configured')}</strong>
          <small>{snapshot.config.model ?? t(locale, '将使用原生 Claude 配置', 'Using native Claude config')}</small>
          {currentUpdatedAt ? <small>{t(locale, `最近更新 ${currentUpdatedAt}`, `Updated ${currentUpdatedAt}`)}</small> : null}
        </div>
      </div>

      <div className="ai-provider-stepper">
        {STEP_IDS.map((stepId, index) => (
          <button
            key={stepId}
            type="button"
            className={`ai-provider-stepper__item ${index === stepIndex ? 'is-active' : ''} ${index < stepIndex ? 'is-complete' : ''}`}
            onClick={() => setStepIndex(index)}
          >
            <span>{index + 1}</span>
            <strong>{stepLabels[index]}</strong>
          </button>
        ))}
      </div>

      {stepIndex === 0 ? (
        <div className="ai-provider-panel">
          <div className="ai-provider-panel__header">
            <div>
              <h4>{t(locale, '先确认 Claude CLI 状态', 'Start with Claude CLI readiness')}</h4>
              <p>{t(locale, '如果 CLI 还没装好，先在这里完成安装。', 'If Claude CLI is not installed yet, complete that first.')}</p>
            </div>
            <span className={`ai-provider-dot ${agent.installStatus.installed ? 'is-success' : 'is-warning'}`} />
          </div>

          <div className="ai-provider-install-grid">
            <div className="ai-provider-surface-block">
              <span className="ai-provider-surface-block__label">{t(locale, 'CLI 状态', 'CLI status')}</span>
              <strong>{agent.installStatus.installed ? t(locale, '已安装', 'Installed') : t(locale, '尚未安装', 'Not installed')}</strong>
              <small>{agent.installStatus.executable ?? t(locale, '未检测到 Claude 可执行命令', 'Claude executable not detected')}</small>
            </div>
            <div className="ai-provider-surface-block">
              <span className="ai-provider-surface-block__label">{t(locale, '生效方式', 'How it applies')}</span>
              <strong>{t(locale, 'GT Office 会在启动 Claude 会话时自动注入配置', 'GT Office injects settings when a Claude session is launched')}</strong>
              <small>{t(locale, '已运行中的 Claude 会话不会热切换。', 'Existing Claude sessions are not hot-swapped.')}</small>
            </div>
          </div>

          {canInstall ? (
            <button
              type="button"
              className="ai-provider-primary-button"
              onClick={onInstall}
              disabled={installDisabled}
            >
              {installing ? t(locale, '安装中...', 'Installing...') : t(locale, '安装 Claude CLI', 'Install Claude CLI')}
            </button>
          ) : (
            <button type="button" className="ai-provider-primary-button" onClick={() => setStepIndex(1)}>
              {t(locale, '继续配置供应商', 'Continue to provider setup')}
            </button>
          )}
        </div>
      ) : null}

      {stepIndex === 1 ? (
        <div className="ai-provider-panel">
          <div className="ai-provider-mode-toggle">
            <button
              type="button"
              className={mode === 'official' ? 'is-active' : ''}
              onClick={() => {
                setMode('official')
                clearDerivedState()
              }}
            >
              {t(locale, '恢复原生 Claude', 'Use native Claude')}
            </button>
            <button
              type="button"
              className={mode === 'preset' ? 'is-active' : ''}
              onClick={() => {
                setMode('preset')
                resetPresetFields(providerId)
              }}
            >
              {t(locale, '精选预设', 'Curated presets')}
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'is-active' : ''}
              onClick={() => {
                setMode('custom')
                setProviderName(snapshot.config.providerName ?? '')
                clearDerivedState()
              }}
            >
              {t(locale, '自定义网关', 'Custom gateway')}
            </button>
          </div>

          {mode === 'official' ? (
            <div className="ai-provider-surface-block">
              <span className="ai-provider-surface-block__label">{t(locale, '原生模式说明', 'Native mode')}</span>
              <strong>{t(locale, 'GT Office 不注入任何 Claude 供应商环境变量，Claude CLI 将继续使用你本机已有的登录或默认配置。', 'GT Office will not inject provider env vars. Claude CLI keeps using your local sign-in or default configuration.')}</strong>
            </div>
          ) : null}

          {mode === 'preset' ? (
            <div className="ai-provider-preset-grid">
              {snapshot.presets
                .filter((preset) => preset.providerId !== 'custom-gateway')
                .map((preset) => (
                  <button
                    key={preset.providerId}
                    type="button"
                    className={`ai-provider-preset-card ${providerId === preset.providerId ? 'is-active' : ''}`}
                    onClick={() => resetPresetFields(preset.providerId)}
                  >
                    <span>{preset.name}</span>
                    <strong>{preset.recommendedModel}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
            </div>
          ) : null}

          {mode === 'custom' ? (
            <div className="ai-provider-surface-block">
              <span className="ai-provider-surface-block__label">{t(locale, '自定义模式说明', 'Custom mode')}</span>
              <strong>{t(locale, '适用于内部网关、企业代理或你自己的兼容端点。', 'Use this for an internal gateway, enterprise proxy, or your own compatible endpoint.')}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {stepIndex === 2 ? (
        <div className="ai-provider-panel">
          <div className="ai-provider-panel__header">
            <div>
              <h4>{t(locale, '不会充值或拿 Key？按这里做', 'Need billing or API key help? Follow this')}</h4>
              <p>{t(locale, '把用户最容易卡住的两件事直接前置：充值和创建 API Key。', 'Surface the two most common blockers first: billing and API key creation.')}</p>
            </div>
            <AppIcon name="sparkles" aria-hidden="true" />
          </div>

          {mode === 'official' ? (
            <div className="ai-provider-surface-block">
              <span className="ai-provider-surface-block__label">{t(locale, '原生模式没有必填表单', 'No required form in native mode')}</span>
              <strong>{t(locale, '如果你已经在本机登录过 Claude CLI，可以直接下一步；如果想用 API Key 托管，请切回“精选预设”。', 'If Claude CLI is already signed in on this machine, continue. Switch back to curated presets if you want GT Office to manage an API key.')}</strong>
            </div>
          ) : (
            <div className="ai-provider-guide-card">
              <div className="ai-provider-guide-card__links">
                <a href={selectedPreset.websiteUrl} target="_blank" rel="noreferrer">
                  {t(locale, '打开供应商控制台', 'Open provider console')}
                </a>
                <a href={selectedPreset.billingUrl} target="_blank" rel="noreferrer">
                  {t(locale, '充值/订阅入口', 'Billing / recharge')}
                </a>
                <a href={selectedPreset.apiKeyUrl} target="_blank" rel="noreferrer">
                  {t(locale, 'API Key 管理页', 'API key page')}
                </a>
              </div>

              <div className="ai-provider-guide-card__summary">
                <div>
                  <span>{t(locale, '推荐理由', 'Why choose it')}</span>
                  <strong>{selectedPreset.whyChoose}</strong>
                </div>
                <div>
                  <span>{t(locale, '适合谁', 'Best for')}</span>
                  <strong>{selectedPreset.bestFor}</strong>
                </div>
              </div>

              <ol className="ai-provider-ordered-list">
                {selectedPreset.setupSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="ai-provider-footer-actions">
            <button type="button" className="ai-provider-link-button" onClick={() => setStepIndex(3)}>
              {t(locale, '跳过引导，直接填写配置', 'Skip guidance and fill settings')}
            </button>
          </div>
        </div>
      ) : null}

      {stepIndex === 3 ? (
        <div className="ai-provider-panel">
          <div className="ai-provider-form-grid">
            {mode === 'custom' ? (
              <label className="ai-provider-field">
                <span>{t(locale, '供应商名称', 'Provider name')}</span>
                <input
                  value={providerName}
                  onChange={(event) => {
                    setProviderName(event.target.value)
                    clearDerivedState()
                  }}
                  placeholder="My Gateway"
                />
              </label>
            ) : null}

            {mode !== 'official' ? (
              <>
                <label className="ai-provider-field">
                  <span>{t(locale, 'Endpoint', 'Endpoint')}</span>
                  <input
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value)
                      clearDerivedState()
                    }}
                    placeholder="https://api.example.com/anthropic"
                  />
                </label>
                <label className="ai-provider-field">
                  <span>{t(locale, '模型名称', 'Model')}</span>
                  <input
                    value={model}
                    onChange={(event) => {
                      setModel(event.target.value)
                      clearDerivedState()
                    }}
                    placeholder="claude-sonnet-4-5"
                  />
                </label>
                <label className="ai-provider-field">
                  <span>{t(locale, '认证变量', 'Auth env')}</span>
                  <select
                    value={authScheme}
                    onChange={(event) => {
                      setAuthScheme(event.target.value as ClaudeAuthScheme)
                      clearDerivedState()
                    }}
                  >
                    <option value="anthropic_api_key">ANTHROPIC_API_KEY</option>
                    <option value="anthropic_auth_token">ANTHROPIC_AUTH_TOKEN</option>
                  </select>
                </label>
                <label className="ai-provider-field">
                  <span>{t(locale, 'API Key', 'API key')}</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value)
                      clearDerivedState()
                    }}
                    placeholder={
                      snapshot.config.hasSecret
                        ? t(locale, '留空则继续使用当前已保存的密钥', 'Leave blank to keep the saved secret')
                        : 'sk-...'
                    }
                  />
                  <small>{t(locale, '密钥只会进入系统凭据库，不会写进 `.gtoffice/config.json`。', 'The key is stored only in the system credential store, never in `.gtoffice/config.json`.')}</small>
                </label>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {stepIndex === 4 ? (
        <div className="ai-provider-panel">
          <div className="ai-provider-panel__header">
            <div>
              <h4>{t(locale, '应用前预览', 'Preview before apply')}</h4>
              <p>{t(locale, '任何 AI 配置变更都必须经过预览、确认和审计。', 'Every AI configuration change goes through preview, confirmation, and audit.')}</p>
            </div>
            <AppIcon name="check" aria-hidden="true" />
          </div>

          {preview ? (
            <div className="ai-provider-diff-list">
              {preview.maskedDiff.map((item) => (
                <div key={item.key} className="ai-provider-diff-list__item">
                  <span>{item.label}</span>
                  <div>
                    <small>{item.before ?? t(locale, '未设置', 'Not set')}</small>
                    <strong>{item.after ?? t(locale, '未设置', 'Not set')}</strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ai-provider-surface-block">
              <span className="ai-provider-surface-block__label">{t(locale, '尚未生成预览', 'Preview not generated yet')}</span>
              <strong>{t(locale, '先生成预览，再决定是否应用。', 'Generate a preview first, then decide whether to apply it.')}</strong>
            </div>
          )}

          {preview?.warnings.length ? (
            <ul className="ai-provider-list">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="ai-provider-feedback ai-provider-feedback--error">{error}</p> : null}
      {success ? <p className="ai-provider-feedback ai-provider-feedback--success">{success}</p> : null}

      <div className="ai-provider-footer-actions">
        <button
          type="button"
          className="ai-provider-secondary-button"
          onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          disabled={stepIndex === 0 || loading}
        >
          {t(locale, '上一步', 'Back')}
        </button>

        {stepIndex < 4 ? (
          <button
            type="button"
            className="ai-provider-primary-button"
            onClick={() => setStepIndex((current) => Math.min(4, current + 1))}
            disabled={loading}
          >
            {t(locale, '下一步', 'Next')}
          </button>
        ) : (
          <>
            <button type="button" className="ai-provider-secondary-button" onClick={handlePreview} disabled={loading}>
              {loading ? t(locale, '处理中...', 'Working...') : t(locale, '生成预览', 'Generate preview')}
            </button>
            <button type="button" className="ai-provider-primary-button" onClick={handleApply} disabled={loading}>
              {loading ? t(locale, '应用中...', 'Applying...') : t(locale, '确认并应用', 'Confirm and apply')}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
