import { useEffect, useState } from 'react'

import {
  desktopApi,
  type AiAgentSnapshotCard,
  type AiConfigPreviewResponse,
  type ClaudeAuthScheme,
  type ClaudeDraftInput,
  type ClaudeProviderMode,
  type ClaudeSnapshot,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { AuditLogView } from '../shared/AuditLogView'

import './ClaudeProviderWorkspace.scss'

interface ClaudeProviderWorkspaceProps {
  locale: Locale
  workspaceId: string
  agent: AiAgentSnapshotCard
  snapshot: ClaudeSnapshot
  installing: boolean
  onInstall: () => void
  onReload: () => Promise<void>
}

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

type Tab = 'setup' | 'audit'

export function ClaudeProviderWorkspace({
  locale,
  workspaceId,
  agent,
  snapshot,
  installing,
  onInstall,
  onReload,
}: ClaudeProviderWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>('setup')
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

  const selectedPreset =
    snapshot.presets.find((preset) => preset.providerId === providerId) ?? snapshot.presets[0]
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
      snapshot.config.providerId &&
      snapshot.presets.some((preset) => preset.providerId === snapshot.config.providerId)
        ? snapshot.config.providerId
        : defaultPresetId(snapshot)
    const nextPreset =
      snapshot.presets.find((preset) => preset.providerId === nextProviderId) ?? snapshot.presets[0]

    setMode(nextMode)
    setProviderId(nextProviderId)
    setProviderName(
      snapshot.config.providerName ?? (nextMode === 'custom' ? '' : nextPreset?.name ?? ''),
    )
    setBaseUrl(snapshot.config.baseUrl ?? (nextPreset?.endpoint ?? ''))
    setModel(snapshot.config.model ?? (nextPreset?.recommendedModel ?? ''))
    setAuthScheme(snapshot.config.authScheme ?? (nextPreset?.authScheme ?? 'anthropic_api_key'))
    setApiKey('')
    clearDerivedState()
    if (activeTab === 'setup') {
      setStepIndex(0)
    }
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

  async function handleGeneratePreview() {
    setLoading(true)
    setError(null)
    try {
      const draft: ClaudeDraftInput = {
        mode,
        providerId: mode === 'preset' ? providerId : undefined,
        providerName: mode === 'custom' ? providerName : undefined,
        baseUrl: mode === 'official' ? undefined : baseUrl,
        model: mode === 'official' ? undefined : model,
        authScheme: mode === 'official' ? undefined : authScheme,
        apiKey: apiKey.trim() || undefined,
      }
      const resp = await desktopApi.aiConfigPreviewPatch(workspaceId, 'claude', 'workspace', draft)
      setPreview(resp)
      setStepIndex(4)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    if (!preview) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      await desktopApi.aiConfigApplyPatch(workspaceId, preview.previewId, 'System Admin')
      setSuccess(t(locale, '配置已成功应用', 'Configuration applied successfully'))
      await onReload()
      setStepIndex(0)
      setPreview(null)
      setActiveTab('audit')
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    {
      id: 'check',
      label: t(locale, '环境检查', 'System Check'),
      active: stepIndex === 0,
      complete: stepIndex > 0,
    },
    {
      id: 'provider',
      label: t(locale, '供应商模式', 'Provider Mode'),
      active: stepIndex === 1,
      complete: stepIndex > 1,
    },
    {
      id: 'guidance',
      label: t(locale, '获取凭据', 'Get Credentials'),
      active: stepIndex === 2,
      complete: stepIndex > 2,
    },
    {
      id: 'details',
      label: t(locale, '详细配置', 'Config Details'),
      active: stepIndex === 3,
      complete: stepIndex > 3,
    },
    {
      id: 'apply',
      label: t(locale, '预览并应用', 'Review & Apply'),
      active: stepIndex === 4,
      complete: false,
    },
  ]

  return (
    <section className="ai-claude-workspace">
      <header className="ai-claude-workspace__header">
        <div>
          <h3>{agent.title}</h3>
          <p>{agent.subtitle}</p>
        </div>
        <div className="ai-provider-guide-card__summary">
          <div>
            <span>{t(locale, '当前状态', 'Status')}</span>
            <strong style={{ color: agent.configStatus === 'configured' ? '#0f8f50' : undefined }}>
              {agent.configStatus === 'configured'
                ? t(locale, '已配置', 'Configured')
                : t(locale, '未配置', 'Unconfigured')}
            </strong>
          </div>
          <div>
            <span>{t(locale, '最后更新', 'Last Updated')}</span>
            <strong>{currentUpdatedAt || t(locale, '从无', 'Never')}</strong>
          </div>
        </div>
      </header>

      <nav className="ai-provider-tabs">
        <button
          className={`ai-provider-tab ${activeTab === 'setup' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('setup')}
        >
          {t(locale, '配置引导', 'Setup Guide')}
        </button>
        <button
          className={`ai-provider-tab ${activeTab === 'audit' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          {t(locale, '审计日志', 'Audit Log')}
        </button>
      </nav>

      {activeTab === 'audit' ? (
        <AuditLogView workspaceId={workspaceId} agent="claude" locale={locale} />
      ) : (
        <>
          <div className="ai-provider-stepper">
            {steps.map((step, idx) => (
              <button
                key={step.id}
                className={`ai-provider-stepper__item ${step.active ? 'is-active' : ''} ${step.complete ? 'is-complete' : ''}`}
                disabled={idx > stepIndex && !step.complete}
                onClick={() => {
                  setStepIndex(idx)
                  clearDerivedState()
                }}
              >
                <span>{idx + 1}</span>
                <strong>{step.label}</strong>
              </button>
            ))}
          </div>

          <div className="ai-provider-panel">
            {stepIndex === 0 && (
              <div className="ai-provider-install-grid">
                <div className="ai-provider-panel__header" style={{ gridColumn: 'span 2' }}>
                  <div>
                    <h4>{t(locale, '运行环境检查', 'Runtime Environment')}</h4>
                    <p>
                      {t(
                        locale,
                        'Claude Code 需要 Node.js 环境。请确保已安装最新版本并将其添加到系统 PATH 中。',
                        'Claude Code requires Node.js. Ensure you have the latest version installed and added to your system PATH.',
                      )}
                    </p>
                  </div>
                </div>
                <div className="ai-provider-guide-card__summary" style={{ gridColumn: 'span 2' }}>
                  <div>
                    <span>{t(locale, 'Node.js 状态', 'Node.js Status')}</span>
                    <strong style={{ color: agent.installStatus.nodeReady ? '#0f8f50' : '#d4af37' }}>
                      {agent.installStatus.nodeReady
                        ? t(locale, '已就绪', 'Ready')
                        : t(locale, '未找到', 'Not Found')}
                    </strong>
                  </div>
                  <div>
                    <span>{t(locale, '安装状态', 'Install Status')}</span>
                    <strong style={{ color: agent.installStatus.installed ? '#0f8f50' : '#d4af37' }}>
                      {agent.installStatus.installed
                        ? t(locale, '已安装 CLI', 'CLI Installed')
                        : t(locale, '未安装', 'Not Installed')}
                    </strong>
                  </div>
                </div>
                <div className="ai-provider-footer-actions" style={{ gridColumn: 'span 2' }}>
                  {canInstall && (
                    <button
                      className="primary-button"
                      disabled={installDisabled}
                      onClick={() => onInstall()}
                    >
                      {installing
                        ? t(locale, '安装中...', 'Installing...')
                        : t(locale, '立即安装 CLI', 'Install CLI')}
                    </button>
                  )}
                  <button className="primary-button" onClick={() => setStepIndex(1)}>
                    {t(locale, '下一步', 'Next')}
                  </button>
                </div>
              </div>
            )}

            {stepIndex === 1 && (
              <div className="ai-provider-guide-card">
                <div className="ai-provider-panel__header">
                  <div>
                    <h4>{t(locale, '选择供应商模式', 'Select Provider Mode')}</h4>
                    <p>
                      {t(
                        locale,
                        '您可以直接连接 Anthropic 官方，也可以通过预设的网关供应商（如 DeepSeek、Kimi）或自定义 API 代理。',
                        'Connect directly to Anthropic, use a preset gateway (DeepSeek, Kimi), or a custom API proxy.',
                      )}
                    </p>
                  </div>
                </div>
                <div className="ai-provider-mode-toggle">
                  <button
                    className={mode === 'official' ? 'is-active' : ''}
                    onClick={() => {
                      setMode('official')
                      clearDerivedState()
                    }}
                  >
                    {t(locale, '官方', 'Official')}
                  </button>
                  <button
                    className={mode === 'preset' ? 'is-active' : ''}
                    onClick={() => {
                      setMode('preset')
                      clearDerivedState()
                    }}
                  >
                    {t(locale, '预设网关', 'Presets')}
                  </button>
                  <button
                    className={mode === 'custom' ? 'is-active' : ''}
                    onClick={() => {
                      setMode('custom')
                      clearDerivedState()
                    }}
                  >
                    {t(locale, '自定义', 'Custom')}
                  </button>
                </div>

                {mode === 'preset' && (
                  <div className="ai-provider-preset-grid">
                    {snapshot.presets
                      .filter((p) => p.providerId !== 'custom-gateway')
                      .map((p) => (
                        <button
                          key={p.providerId}
                          className={`ai-provider-preset-card ${providerId === p.providerId ? 'is-active' : ''}`}
                          onClick={() => resetPresetFields(p.providerId)}
                        >
                          <span>{p.category}</span>
                          <strong>{p.name}</strong>
                          <small>{p.description}</small>
                        </button>
                      ))}
                  </div>
                )}

                <div className="ai-provider-footer-actions">
                  <button className="secondary-button" onClick={() => setStepIndex(0)}>
                    {t(locale, '上一步', 'Back')}
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => setStepIndex(mode === 'official' ? 3 : 2)}
                  >
                    {t(locale, '下一步', 'Next')}
                  </button>
                </div>
              </div>
            )}

            {stepIndex === 2 && (
              <div className="ai-provider-guide-card">
                <div className="ai-provider-panel__header">
                  <div>
                    <h4>
                      {t(locale, '获取凭据引导', 'Credentials Guide')}: {selectedPreset.name}
                    </h4>
                    <p>{selectedPreset.description}</p>
                  </div>
                </div>
                <div className="ai-provider-guide-card__summary">
                  <div>
                    <span>{t(locale, '推荐模型', 'Recommended')}</span>
                    <strong>{selectedPreset.recommendedModel}</strong>
                  </div>
                  <div>
                    <span>{t(locale, '鉴权方案', 'Auth Scheme')}</span>
                    <strong>{selectedPreset.authScheme}</strong>
                  </div>
                </div>
                <div className="ai-provider-diff-list">
                  {selectedPreset.setupSteps.map((step, idx) => (
                    <div key={idx} className="ai-provider-diff-list__item">
                      <div className="ai-provider-dot is-warning" />
                      <div style={{ alignItems: 'flex-start', flex: 1 }}>
                        <strong>
                          {t(locale, '步骤', 'Step')} {idx + 1}
                        </strong>
                        <small>{step}</small>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="ai-provider-guide-card__links">
                  <a href={selectedPreset.websiteUrl} target="_blank" rel="noreferrer">
                    <AppIcon name="external" width={14} height={14} style={{ marginRight: 6 }} />
                    {t(locale, '供应商官网', 'Website')}
                  </a>
                  <a href={selectedPreset.apiKeyUrl} target="_blank" rel="noreferrer">
                    <AppIcon name="bolt" width={14} height={14} style={{ marginRight: 6 }} />
                    {t(locale, '获取 API Key', 'Get API Key')}
                  </a>
                </div>
                <div className="ai-provider-footer-actions">
                  <button className="secondary-button" onClick={() => setStepIndex(1)}>
                    {t(locale, '上一步', 'Back')}
                  </button>
                  <button className="primary-button" onClick={() => setStepIndex(3)}>
                    {t(locale, '已获取，下一步', 'Got it, next')}
                  </button>
                </div>
              </div>
            )}

            {stepIndex === 3 && (
              <div className="ai-provider-guide-card">
                <div className="ai-provider-panel__header">
                  <div>
                    <h4>{t(locale, '详细参数配置', 'Configuration Details')}</h4>
                    <p>
                      {mode === 'official'
                        ? t(
                            locale,
                            '官方模式下，配置将由 CLI 自动托管。',
                            'In official mode, config is managed by CLI.',
                          )
                        : t(
                            locale,
                            '请核对 API 端点、模型名称并填入您的 API Key。',
                            'Please verify the endpoint, model, and enter your API Key.',
                          )}
                    </p>
                  </div>
                </div>

                {mode !== 'official' && (
                  <div className="ai-provider-form-grid">
                    <div className="ai-provider-field" style={{ gridColumn: mode === 'custom' ? '1' : 'span 2' }}>
                      <span>{t(locale, '网关名称', 'Provider Name')}</span>
                      <input
                        type="text"
                        value={providerName}
                        readOnly={mode === 'preset'}
                        onChange={(e) => setProviderName(e.target.value)}
                      />
                    </div>
                    {mode === 'custom' && (
                      <div className="ai-provider-field">
                        <span>{t(locale, '鉴权方案', 'Auth Scheme')}</span>
                        <select
                          value={authScheme}
                          onChange={(e) => setAuthScheme(e.target.value as ClaudeAuthScheme)}
                        >
                          <option value="anthropic_api_key">ANTHROPIC_API_KEY</option>
                          <option value="anthropic_auth_token">ANTHROPIC_AUTH_TOKEN</option>
                        </select>
                      </div>
                    )}
                    <div className="ai-provider-field" style={{ gridColumn: 'span 2' }}>
                      <span>{t(locale, 'API 端点 (Base URL)', 'Endpoint URL')}</span>
                      <input
                        type="text"
                        value={baseUrl}
                        placeholder="https://..."
                        readOnly={mode === 'preset'}
                        onChange={(e) => setBaseUrl(e.target.value)}
                      />
                    </div>
                    <div className="ai-provider-field">
                      <span>{t(locale, '模型 (Model)', 'Model')}</span>
                      <input
                        type="text"
                        value={model}
                        placeholder="claude-3-5-sonnet-20241022"
                        onChange={(e) => setModel(e.target.value)}
                      />
                    </div>
                    <div className="ai-provider-field">
                      <span>{t(locale, 'API Key', 'API Key')}</span>
                      <input
                        type="password"
                        value={apiKey}
                        autoComplete="new-password"
                        placeholder={
                          snapshot.config.hasSecret
                            ? t(locale, '已托管 (输入以覆盖)', 'Vaulted (enter to override)')
                            : t(locale, '未设置', 'Not set')
                        }
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {mode === 'official' && (
                  <div className="ai-provider-diff-list">
                    <div className="ai-provider-diff-list__item">
                      <div className="ai-provider-dot is-success" />
                      <div style={{ alignItems: 'flex-start', flex: 1 }}>
                        <strong>{t(locale, '官方直连', 'Direct Official')}</strong>
                        <small>
                          {t(
                            locale,
                            '直接使用 `claude` 命令内置的登录与配置流程。GT Office 不会干预其凭据。',
                            'Uses the native `claude` login flow. GT Office will not intercept credentials.',
                          )}
                        </small>
                      </div>
                    </div>
                  </div>
                )}

                <div className="ai-provider-footer-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setStepIndex(mode === 'official' ? 1 : 2)}
                  >
                    {t(locale, '上一步', 'Back')}
                  </button>
                  <button
                    className="primary-button"
                    disabled={loading}
                    onClick={() => void handleGeneratePreview()}
                  >
                    {loading
                      ? t(locale, '生成中...', 'Generating...')
                      : t(locale, '查看预览', 'Preview Changes')}
                  </button>
                </div>
              </div>
            )}

            {stepIndex === 4 && preview && (
              <div className="ai-provider-guide-card">
                <div className="ai-provider-panel__header">
                  <div>
                    <h4>{t(locale, '核对并确认变更', 'Review & Confirm')}</h4>
                    <p>
                      {t(
                        locale,
                        '请确认以下变更。凭据将加密存储，其他配置将写入工作区设置。',
                        'Please confirm changes. Credentials will be vaulted, other configs saved to workspace settings.',
                      )}
                    </p>
                  </div>
                </div>

                <div className="ai-provider-diff-list">
                  {preview.maskedDiff.map((change) => (
                    <div key={change.key} className="ai-provider-diff-list__item">
                      <span>{change.label}</span>
                      <div>
                        <small>{change.before || t(locale, '(空)', '(empty)')}</small>
                        <strong style={{ color: '#007aff' }}>
                          {change.secret ? '********' : change.after}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>

                {preview.warnings.length > 0 && (
                  <div className="ai-provider-diff-list" style={{ marginTop: 8 }}>
                    {preview.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="ai-provider-diff-list__item"
                        style={{ background: '#fff9e6', borderColor: '#ffe58f' }}
                      >
                        <div className="ai-provider-dot is-warning" />
                        <small style={{ color: '#856404' }}>{w}</small>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ai-provider-footer-actions">
                  <button className="secondary-button" onClick={() => setStepIndex(3)}>
                    {t(locale, '返回修改', 'Modify')}
                  </button>
                  <button className="primary-button" disabled={loading} onClick={() => void handleApply()}>
                    {loading ? t(locale, '应用中...', 'Applying...') : t(locale, '确认并应用', 'Confirm & Apply')}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="error-message" style={{ marginTop: 16 }}>
                {error}
              </div>
            )}
            {success && (
              <div className="success-message" style={{ marginTop: 16 }}>
                {success}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
