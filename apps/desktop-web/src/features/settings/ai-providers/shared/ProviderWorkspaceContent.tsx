import type { ClaudeApiFormat, ClaudeAuthScheme } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { ProviderWorkspaceEndpointDialog } from './ProviderWorkspaceEndpointDialog'
import {
  localizeLabel,
  resolveModeLabel,
  resolveSavedProviderFacts,
  resolveSavedProviderMeta,
} from './provider-workspace-presenter.js'
import { ProviderIconButton } from './provider-workspace-shared'
import type { useProviderWorkspaceController } from './useProviderWorkspaceController'

interface ProviderWorkspaceContentProps {
  agentId: 'claude' | 'codex'
  locale: Locale
  controller: ReturnType<typeof useProviderWorkspaceController>
}

export function ProviderWorkspaceContent({
  agentId,
  locale,
  controller,
}: ProviderWorkspaceContentProps) {
  const {
    viewMode,
    setViewMode,
    seed,
    applySeed,
    loading,
    importingCurrent,
    switchingSavedProviderId,
    deletingSavedProviderId,
    searchValue,
    setSearchValue,
    showAdvanced,
    setShowAdvanced,
    showPresetPicker,
    setShowPresetPicker,
    showConfigTemplate,
    setShowConfigTemplate,
    fetchedModels,
    fetchingModels,
    endpointDialogOpen,
    setEndpointDialogOpen,
    error,
    success,
    selectablePresets,
    savedProviders,
    filteredSavedProviders,
    currentPreset,
    providerLabel,
    canApplyOfficialMode,
    canImportCurrent,
    canReuseSecret,
    requiresApiKey,
    isFormValid,
    openCreateEditor,
    openEditEditor,
    openDuplicateEditor,
    handleModeSelect,
    handlePresetSelect,
    handleApply,
    handleFetchModels,
    handleSwitchSavedProvider,
    handleImportCurrent,
    requestDeleteSavedProvider,
    resetToCurrent,
    clearFeedback,
    openUrl,
  } = controller

  const codexTemplatePlaceholder =
    agentId === 'codex' && currentPreset && 'configTemplate' in currentPreset
      ? currentPreset.configTemplate
      : ''
  const endpointCandidates = Array.from(
    new Set([
      currentPreset?.endpoint ?? '',
      seed.baseUrl,
    ].map((value) => value.trim()).filter(Boolean)),
  )
  const showModelFetch = seed.mode !== 'official' && requiresApiKey
  const providerLinks = [
    currentPreset?.websiteUrl ? { label: t(locale, '官网', 'Website'), url: currentPreset.websiteUrl } : null,
    currentPreset?.apiKeyUrl ? { label: t(locale, '获取密钥', 'Get API key'), url: currentPreset.apiKeyUrl } : null,
    currentPreset?.billingUrl ? { label: t(locale, '控制台', 'Console'), url: currentPreset.billingUrl } : null,
  ].filter((item): item is { label: string; url: string } => Boolean(item?.url))

  const editorTitle =
    seed.editorMode === 'edit'
      ? t(locale, '编辑模型供应商', 'Edit provider')
      : seed.editorMode === 'duplicate'
        ? t(locale, '复制模型供应商', 'Duplicate provider')
        : t(locale, '新增模型供应商', 'Add provider')

  return (
    <div className="provider-workspace">
      {error && <div className="provider-workspace__feedback is-error">{error}</div>}
      {success && <div className="provider-workspace__feedback is-success">{success}</div>}

      {viewMode === 'list' ? (
        <section className="provider-workspace__panel">
          <div className="provider-workspace__toolbar">
            <div>
              <h4>{t(locale, '已保存供应商', 'Saved providers')}</h4>
              <p>{t(locale, '这里集中管理已保存配置，可直接新增、切换、复制或删除。', 'Manage saved provider configurations here. Add, switch, duplicate, or delete from one place.')}</p>
            </div>
            <div className="provider-workspace__toolbar-actions">
              {canImportCurrent && (
                <button type="button" className="nav-btn btn-secondary provider-workspace__primary-action" onClick={() => void handleImportCurrent()} disabled={importingCurrent || loading}>
                  <AppIcon name={importingCurrent ? 'activity' : 'cloud-download'} width={15} height={15} />
                  {importingCurrent ? t(locale, '导入中...', 'Importing...') : t(locale, '导入当前配置', 'Import current config')}
                </button>
              )}
              <label className="provider-workspace__search-wrap">
                <AppIcon name="search" width={15} height={15} />
                <input className="provider-workspace__search" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder={t(locale, '搜索名称、模型或地址', 'Search name, model, or endpoint')} aria-label={t(locale, '搜索模型供应商', 'Search providers')} />
              </label>
              <button type="button" className="nav-btn btn-primary provider-workspace__primary-action" onClick={openCreateEditor}>
                <AppIcon name="plus" width={15} height={15} />
                {t(locale, '新增', 'Add')}
              </button>
            </div>
          </div>

          {filteredSavedProviders.length === 0 ? (
            <div className="provider-workspace__empty">
              <strong>{savedProviders.length === 0 ? t(locale, '还没有模型供应商', 'No providers yet') : t(locale, '没有匹配的结果', 'No matching providers')}</strong>
              <p>{savedProviders.length === 0 ? canImportCurrent ? t(locale, '检测到当前已有生效配置，可先导入为已保存供应商再继续管理。', 'A live provider configuration is already active. Import it first to manage it here.') : t(locale, '先新增一份配置，后续可直接切换或复制。', 'Create your first provider configuration to switch or duplicate later.') : t(locale, '试试更短的关键词，或者清空搜索后再查看全部列表。', 'Try a shorter keyword or clear the search to see everything again.')}</p>
              {savedProviders.length === 0 && (
                <div className="provider-workspace__toolbar-actions">
                  {canImportCurrent && (
                    <button type="button" className="nav-btn btn-secondary" onClick={() => void handleImportCurrent()} disabled={importingCurrent || loading}>
                      <AppIcon name={importingCurrent ? 'activity' : 'cloud-download'} width={15} height={15} />
                      {importingCurrent ? t(locale, '导入中...', 'Importing...') : t(locale, '导入当前配置', 'Import current config')}
                    </button>
                  )}
                  <button type="button" className="nav-btn btn-primary" onClick={openCreateEditor}>
                    <AppIcon name="plus" width={15} height={15} />
                    {t(locale, '立即新增', 'Create now')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="provider-workspace__list">
              {filteredSavedProviders.map((savedProvider) => {
                const isBusy = loading || switchingSavedProviderId === savedProvider.savedProviderId || deletingSavedProviderId === savedProvider.savedProviderId
                const savedProviderMeta = resolveSavedProviderMeta(locale, agentId, savedProvider)
                const savedProviderFacts = resolveSavedProviderFacts(locale, savedProvider)

                return (
                  <article key={savedProvider.savedProviderId} className={`provider-workspace__item ${savedProvider.isActive ? 'is-active' : ''}`}>
                    <div className="provider-workspace__item-main">
                      <div className="provider-workspace__item-top">
                        <div className="provider-workspace__item-title">
                          <strong>{localizeLabel(locale, savedProvider.providerName)}</strong>
                          {savedProvider.isActive && <span className="provider-workspace__badge"><AppIcon name="check" width={12} height={12} />{t(locale, '当前生效', 'Active')}</span>}
                        </div>
                        <div className="provider-workspace__item-meta">{savedProviderMeta.map((meta, index) => <span key={`${meta}-${index}`}>{meta}</span>)}</div>
                      </div>
                      <div className="provider-workspace__item-facts">
                        {savedProviderFacts.map((fact) => <div key={fact.label} className="provider-workspace__item-fact"><span>{fact.label}</span><strong title={fact.value}>{fact.value}</strong></div>)}
                      </div>
                    </div>
                    <div className="provider-workspace__item-actions">
                      {!savedProvider.isActive && <ProviderIconButton icon={switchingSavedProviderId === savedProvider.savedProviderId ? 'activity' : 'check'} label={switchingSavedProviderId === savedProvider.savedProviderId ? t(locale, '切换中...', 'Switching...') : t(locale, '设为当前', 'Set active')} disabled={isBusy} onClick={() => void handleSwitchSavedProvider(savedProvider.savedProviderId)} />}
                      <ProviderIconButton icon="pencil" label={t(locale, '编辑', 'Edit')} disabled={isBusy} onClick={() => openEditEditor(savedProvider.savedProviderId)} />
                      <ProviderIconButton icon="copy" label={t(locale, '复制', 'Duplicate')} disabled={isBusy} onClick={() => openDuplicateEditor(savedProvider.savedProviderId)} />
                      <ProviderIconButton icon={deletingSavedProviderId === savedProvider.savedProviderId ? 'activity' : 'trash'} label={deletingSavedProviderId === savedProvider.savedProviderId ? t(locale, '删除中...', 'Deleting...') : t(locale, '删除', 'Delete')} disabled={isBusy} tone="danger" onClick={() => requestDeleteSavedProvider(savedProvider.savedProviderId)} />
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="provider-workspace__panel">
          <div className="provider-workspace__toolbar is-editor">
            <div>
              <button type="button" className="provider-workspace__back" onClick={() => { setViewMode('list'); clearFeedback() }}>
                <AppIcon name="chevron-left" width={16} height={16} />
                {t(locale, '返回列表', 'Back to list')}
              </button>
              <h4>{editorTitle}</h4>
              <p>{seed.editorMode === 'duplicate' ? t(locale, '已复制原配置，请按需调整并重新保存。', 'The existing configuration has been copied. Adjust the fields and save as a new provider.') : t(locale, '配置保存后会全局生效，所有工作目录共用。', 'Saved providers apply globally across every workspace.')}</p>
            </div>
            <div className="provider-workspace__toolbar-actions">
              <ProviderIconButton icon="rotate-ccw" label={t(locale, '恢复当前配置', 'Reset to current')} disabled={loading} onClick={resetToCurrent} />
            </div>
          </div>

          <div className="provider-workspace__mode-toggle">
            {([['official', t(locale, '官方', 'Official')], ['preset', t(locale, '预设', 'Preset')], ['custom', t(locale, '自定义', 'Custom')]] as const).map(([value, label]) => (
              <button key={value} type="button" className={seed.mode === value ? 'is-active' : ''} disabled={value === 'official' && !canApplyOfficialMode} onClick={() => handleModeSelect(value)}>
                {label}
              </button>
            ))}
          </div>

          {seed.mode === 'preset' && selectablePresets.length > 0 && (
            <div className="provider-workspace__preset-section">
              <div className="provider-workspace__preset-header">
                <div>
                  <strong>{t(locale, '预设供应商', 'Preset providers')}</strong>
                  {!showPresetPicker && currentPreset && (
                    <p>{localizeLabel(locale, currentPreset.name)}</p>
                  )}
                </div>
                <button type="button" className="provider-workspace__preset-toggle" onClick={() => setShowPresetPicker((value) => !value)}>
                  <AppIcon name={showPresetPicker ? 'chevron-up' : 'chevron-down'} width={14} height={14} />
                  {showPresetPicker ? t(locale, '收起', 'Collapse') : t(locale, '更换', 'Change')}
                </button>
              </div>
              {showPresetPicker && (
                <div className="provider-workspace__preset-grid">
                  {selectablePresets.map((preset) => (
                    <button key={preset.providerId} type="button" className={`provider-workspace__preset-card ${seed.providerId === preset.providerId ? 'is-active' : ''}`} onClick={() => handlePresetSelect(preset.providerId)}>
                      <span>{localizeLabel(locale, preset.category)}</span>
                      <strong title={localizeLabel(locale, preset.name)}>{localizeLabel(locale, preset.name)}</strong>
                      <small title={localizeLabel(locale, preset.description)}>{localizeLabel(locale, preset.description)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="provider-workspace__selection">
            <div><span>{t(locale, '当前选择', 'Current selection')}</span><strong>{providerLabel || t(locale, '未命名供应商', 'Unnamed provider')}</strong></div>
            <div><span>{t(locale, '模式', 'Mode')}</span><strong>{resolveModeLabel(locale, seed.mode)}</strong></div>
            <div><span>{t(locale, '推荐模型', 'Recommended model')}</span><strong>{seed.model || currentPreset?.recommendedModel || t(locale, '默认模型', 'Default model')}</strong></div>
          </div>

          {providerLinks.length > 0 && (
            <div className="provider-workspace__link-row">
              {providerLinks.map((linkItem) => (
                <button key={linkItem.url} type="button" className="nav-btn btn-secondary" onClick={() => void openUrl(linkItem.url)}>
                  <AppIcon name="external" width={14} height={14} />
                  {linkItem.label}
                </button>
              ))}
            </div>
          )}

          <div className="provider-workspace__form">
            {seed.mode === 'custom' && <label className="provider-workspace__field"><span>{t(locale, '供应商名称', 'Provider name')}</span><input type="text" value={seed.providerName} placeholder={t(locale, '例如：团队网关', 'For example: Team gateway')} onChange={(event) => { clearFeedback(); applySeed({ providerName: event.target.value }) }} /></label>}
            {agentId === 'claude' && seed.mode !== 'official' && <label className="provider-workspace__field"><span>{t(locale, '密钥类型', 'Credential type')}</span><select value={seed.authScheme} onChange={(event) => { clearFeedback(); applySeed({ authScheme: event.target.value as ClaudeAuthScheme }) }}><option value="anthropic_api_key">ANTHROPIC_API_KEY</option><option value="anthropic_auth_token">ANTHROPIC_AUTH_TOKEN</option></select></label>}
            {seed.mode !== 'official' && <label className="provider-workspace__field is-wide"><span>{t(locale, 'Base URL', 'Base URL')}</span><div className="provider-workspace__input-with-actions"><input type="text" value={seed.baseUrl} placeholder={t(locale, 'https://api.example.com', 'https://api.example.com')} onChange={(event) => { clearFeedback(); applySeed({ baseUrl: event.target.value }) }} /><button type="button" className="provider-workspace__tool-button" onClick={() => setEndpointDialogOpen(true)} title={t(locale, '管理候选端点并测速', 'Manage endpoint candidates and test latency')}><AppIcon name="bolt" width={15} height={15} /></button></div></label>}
            {seed.mode !== 'official' && <label className="provider-workspace__field"><span>{t(locale, '模型', 'Model')}</span><div className="provider-workspace__input-with-actions"><input type="text" value={seed.model} placeholder={currentPreset?.recommendedModel ?? ''} onChange={(event) => { clearFeedback(); applySeed({ model: event.target.value }) }} />{showModelFetch && <button type="button" className="provider-workspace__tool-button" onClick={() => void handleFetchModels()} disabled={fetchingModels} title={t(locale, '拉取模型列表', 'Fetch model list')}><AppIcon name={fetchingModels ? 'activity' : 'cloud-download'} width={15} height={15} /></button>}</div>{fetchedModels.length > 0 && <div className="provider-workspace__model-chips">{fetchedModels.slice(0, 12).map((item) => <button key={item.id} type="button" className={`provider-workspace__model-chip ${seed.model === item.id ? 'is-active' : ''}`} onClick={() => { clearFeedback(); applySeed({ model: item.id }) }}>{item.id}</button>)}{fetchedModels.length > 12 && <span className="provider-workspace__model-more">+{fetchedModels.length - 12}</span>}</div>}</label>}
            {(requiresApiKey || canReuseSecret) && <label className="provider-workspace__field"><span>{agentId === 'claude' ? seed.authScheme === 'anthropic_auth_token' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}</span><input type="password" autoComplete="new-password" value={seed.apiKey} placeholder={canReuseSecret ? t(locale, '沿用已托管密钥', 'Reuse vaulted secret') : 'sk-...'} onChange={(event) => { clearFeedback(); applySeed({ apiKey: event.target.value }) }} /><small>{canReuseSecret ? t(locale, '留空则继续使用当前托管密钥。', 'Leave empty to keep using the vaulted secret.') : t(locale, '保存后会写入系统凭证库，不会明文落盘。', 'The credential is stored in the system keychain and never written in plaintext.')}</small></label>}
            {agentId === 'codex' && seed.mode !== 'official' && <div className="provider-workspace__advanced"><button type="button" className="provider-workspace__advanced-toggle" onClick={() => setShowConfigTemplate((value) => !value)}><AppIcon name={showConfigTemplate ? 'chevron-up' : 'chevron-down'} width={13} height={13} />{showConfigTemplate ? t(locale, '收起配置模板', 'Hide config template') : t(locale, '展开配置模板', 'Show config template')}</button>{showConfigTemplate && <label className="provider-workspace__field is-wide"><span>{t(locale, 'Codex 配置模板', 'Codex config template')}</span><textarea value={seed.configToml} onChange={(event) => { clearFeedback(); applySeed({ configToml: event.target.value }) }} placeholder={codexTemplatePlaceholder} /></label>}</div>}
            {agentId === 'claude' && seed.mode !== 'official' && <div className="provider-workspace__advanced"><button type="button" className="provider-workspace__advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}><AppIcon name={showAdvanced ? 'chevron-up' : 'chevron-down'} width={13} height={13} />{showAdvanced ? t(locale, '收起高级选项', 'Hide advanced options') : t(locale, '展开高级选项', 'Advanced options')}</button>{showAdvanced && <div className="provider-workspace__advanced-fields"><label className="provider-workspace__field"><span>{t(locale, 'API 格式', 'API format')}</span><select value={seed.apiFormat} onChange={(event) => { clearFeedback(); applySeed({ apiFormat: event.target.value as ClaudeApiFormat }) }}><option value="anthropic">{t(locale, 'Anthropic（原生）', 'Anthropic (native)')}</option><option value="openai_chat">{t(locale, 'OpenAI Chat（需代理）', 'OpenAI Chat (proxy required)')}</option><option value="openai_responses">{t(locale, 'OpenAI Responses（需代理）', 'OpenAI Responses (proxy required)')}</option></select>{(seed.apiFormat === 'openai_chat' || seed.apiFormat === 'openai_responses') && <small className="is-warning">{t(locale, '⚠️ 此格式需要代理中间件才能正常工作', '⚠️ This format requires a proxy middleware to function')}</small>}</label><label className="provider-workspace__field"><span>{t(locale, 'Haiku 模型覆盖', 'Haiku model override')}</span><input type="text" value={seed.modelOverrides.haikuModel ?? ''} placeholder={seed.model || t(locale, '与主模型相同', 'Same as main model')} onChange={(event) => { clearFeedback(); applySeed({ modelOverrides: { ...seed.modelOverrides, haikuModel: event.target.value || undefined } }) }} /></label><label className="provider-workspace__field"><span>{t(locale, 'Sonnet 模型覆盖', 'Sonnet model override')}</span><input type="text" value={seed.modelOverrides.sonnetModel ?? ''} placeholder={seed.model || t(locale, '与主模型相同', 'Same as main model')} onChange={(event) => { clearFeedback(); applySeed({ modelOverrides: { ...seed.modelOverrides, sonnetModel: event.target.value || undefined } }) }} /></label><label className="provider-workspace__field"><span>{t(locale, 'Opus 模型覆盖', 'Opus model override')}</span><input type="text" value={seed.modelOverrides.opusModel ?? ''} placeholder={seed.model || t(locale, '与主模型相同', 'Same as main model')} onChange={(event) => { clearFeedback(); applySeed({ modelOverrides: { ...seed.modelOverrides, opusModel: event.target.value || undefined } }) }} /></label></div>}</div>}
          </div>

          <div className="provider-workspace__footer">
            <button type="button" className="nav-btn btn-secondary" disabled={loading} onClick={() => { setViewMode('list'); clearFeedback() }}>
              <AppIcon name="x-mark" width={15} height={15} />
              {t(locale, '取消', 'Cancel')}
            </button>
            <div className="provider-workspace__footer-actions">
              <button type="button" className="nav-btn btn-primary" disabled={!isFormValid || loading} onClick={() => void handleApply()}>
                <AppIcon name={loading ? 'activity' : 'check'} width={15} height={15} />
                {loading ? t(locale, '保存中...', 'Saving...') : seed.editorMode === 'edit' ? t(locale, '保存更新', 'Save changes') : t(locale, '保存配置', 'Save provider')}
              </button>
            </div>
          </div>
        </section>
      )}
      {endpointDialogOpen && (
        <ProviderWorkspaceEndpointDialog
          agentId={agentId}
          locale={locale}
          currentValue={seed.baseUrl}
          initialUrls={endpointCandidates}
          onSelect={(url) => {
            clearFeedback()
            applySeed({ baseUrl: url })
            setEndpointDialogOpen(false)
          }}
          onClose={() => setEndpointDialogOpen(false)}
        />
      )}
    </div>
  )
}
