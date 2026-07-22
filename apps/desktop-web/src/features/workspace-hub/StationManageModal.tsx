import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { desktopApi } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { trapModalTabFocus } from '@/components/modal/modal-focus-trap'
import { requestStandardModalClose } from '@/components/modal/standard-modal-close'
import { createStationTerminalFrameFlushScheduler } from '../terminal/station-terminal-frame-flush-scheduler'

import type { CreateStationInput, UpdateStationInput } from './station-model'
import {
  buildDefaultAgentWorkdir,
  buildSuggestedAgentWorkdir,
  isWorkspaceRootAgentWorkdir,
  resolveAvailableAgentProviders,
  resolveManagedProviderKey,
  resolvePromptFileRelativePathForProvider,
  resolvePromptFileNameForProvider,
  resolveProviderLabel,
  type ManagedAgentProvider,
} from './agent-management-model'
import {
  loadLaunchCommandHistory,
  recordLaunchCommand,
  deleteLaunchCommand,
  getLaunchCommandHistoryForProvider,
  type LaunchCommandHistory,
} from './launch-command-model'
import { StationDeleteBindingCleanupDialog } from './StationDeleteBindingCleanupDialog'
import type {
  StationDeleteCleanupState,
  StationDeleteCleanupStrategy,
} from './station-delete-binding-cleanup-model'
import { resolveStationManageModalCopy } from './station-manage-copy'
import { scheduleStationModalFocusFrame } from './station-modal-focus-frame'

import './StationManageModal.scss'

const STATION_MANAGE_MODAL_FOCUS_FALLBACK_DELAY_MS = 48

interface StationManageModalProps {
  open: boolean
  locale: Locale
  workspaceId?: string | null
  editingStation?: UpdateStationInput | null
  saving?: boolean
  deleting?: boolean
  deleteCleanupState?: StationDeleteCleanupState | null
  deleteCleanupSubmitting?: boolean
  onClose: () => void
  onPickWorkdir: () => Promise<string | null>
  onSubmit: (input: CreateStationInput | UpdateStationInput) => Promise<void> | void
  onDelete?: (stationId: string) => Promise<void> | void
  onDeleteCleanupClose?: () => void
  onDeleteCleanupStrategyChange?: (strategy: StationDeleteCleanupStrategy) => void
  onDeleteCleanupReplacementChange?: (agentId: string) => void
  onDeleteCleanupConfirm?: () => void
  onRolesChanged?: () => Promise<void> | void
}

export function StationManageModal({
  open,
  locale,
  workspaceId,
  editingStation,
  saving = false,
  deleting = false,
  deleteCleanupState = null,
  deleteCleanupSubmitting = false,
  onClose,
  onPickWorkdir,
  onSubmit,
  onDelete,
  onDeleteCleanupClose,
  onDeleteCleanupStrategyChange,
  onDeleteCleanupReplacementChange,
  onDeleteCleanupConfirm,
}: StationManageModalProps) {
  const formDialogRef = useRef<HTMLElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ManagedAgentProvider>('codex')
  const [workdir, setWorkdir] = useState('')
  const [launchCommand, setLaunchCommand] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [customWorkdirEnabled, setCustomWorkdirEnabled] = useState(false)
  const [promptEnabled, setPromptEnabled] = useState(false)
  const [promptDraftMode, setPromptDraftMode] = useState<'auto' | 'manual'>('auto')
  const [promptPrefillLoading, setPromptPrefillLoading] = useState(false)
  const [availableProviders, setAvailableProviders] = useState<
    ReturnType<typeof resolveAvailableAgentProviders>
  >([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [launchCommandHistory, setLaunchCommandHistory] = useState<LaunchCommandHistory>({})

  const isEdit = Boolean(editingStation)
  const copy = useMemo(() => resolveStationManageModalCopy(locale, isEdit), [isEdit, locale])
  const defaultWorkdir = useMemo(() => buildDefaultAgentWorkdir(name.trim() || copy.defaultName), [copy.defaultName, name])
  const suggestedCustomWorkdir = useMemo(
    () => buildSuggestedAgentWorkdir(name.trim() || copy.defaultName),
    [copy.defaultName, name],
  )
  const promptFileName = resolvePromptFileNameForProvider(provider)
  const activePromptWorkdir = customWorkdirEnabled ? workdir : defaultWorkdir
  const providerHistoryCommands = useMemo(
    () => getLaunchCommandHistoryForProvider(launchCommandHistory, provider),
    [launchCommandHistory, provider],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    const initialWorkdir = editingStation?.workdir?.trim() || buildDefaultAgentWorkdir(copy.defaultName)
    setName(editingStation?.name ?? '')
    setProvider(resolveManagedProviderKey(editingStation?.tool))
    setWorkdir(initialWorkdir)
    setCustomWorkdirEnabled(initialWorkdir !== '.')
    setLaunchCommand(editingStation?.launchCommand ?? '')
    setPromptContent('')
    setPromptEnabled(editingStation?.promptEnabled ?? false)
    setPromptDraftMode(editingStation ? 'manual' : 'auto')
    setPromptPrefillLoading(false)
    setLaunchCommandHistory(loadLaunchCommandHistory())
  }, [copy.defaultName, editingStation, open])

  useEffect(() => {
    if (!open) {
      return
    }
    const focusFrame = scheduleStationModalFocusFrame({
      scheduler: createStationTerminalFrameFlushScheduler(window),
      fallbackDelayMs: STATION_MANAGE_MODAL_FOCUS_FALLBACK_DELAY_MS,
      focus: () => {
        nameInputRef.current?.focus()
      },
    })
    return focusFrame.cancel
  }, [open])

  useEffect(() => {
    if (!open || !workspaceId || !desktopApi.isTauriRuntime()) {
      setAvailableProviders([])
      setProvidersLoaded(false)
      return
    }
    let cancelled = false
    void (async () => {
      setProvidersLoading(true)
      try {
        const snapshot = await desktopApi.aiConfigReadSnapshot(workspaceId)
        if (cancelled) {
          return
        }
        const resolved = resolveAvailableAgentProviders(snapshot.snapshot.agents)
        setAvailableProviders(resolved)
        setProvidersLoaded(true)
        if (resolved.length > 0 && !resolved.some((item) => item.key === provider)) {
          setProvider(resolved[0].key)
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, provider, workspaceId])

  useEffect(() => {
    if (!open || !workspaceId || !editingStation || !desktopApi.isTauriRuntime()) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await desktopApi.agentPromptRead({
          workspaceId,
          agentId: editingStation.id,
        })
        if (!cancelled) {
          setPromptContent(response.promptContent)
          setPromptEnabled(Boolean(response.promptFileRelativePath))
        }
      } catch {
        if (!cancelled) {
          setPromptContent('')
          setPromptEnabled(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editingStation, open, workspaceId])

  useEffect(() => {
    if (!open || isEdit) {
      setPromptPrefillLoading(false)
      return
    }
    if (!workspaceId || !desktopApi.isTauriRuntime()) {
      setPromptPrefillLoading(false)
      return
    }
    if (promptDraftMode !== 'auto') {
      setPromptPrefillLoading(false)
      return
    }
    if (customWorkdirEnabled || !isWorkspaceRootAgentWorkdir(activePromptWorkdir)) {
      setPromptPrefillLoading(false)
      setPromptEnabled(false)
      setPromptContent('')
      return
    }

    const promptPath = resolvePromptFileRelativePathForProvider(provider, activePromptWorkdir)
    let cancelled = false
    void (async () => {
      setPromptPrefillLoading(true)
      try {
        const statResponse = await desktopApi.fsStatFiles(workspaceId, [promptPath])
        if (cancelled) {
          return
        }
        const promptExists = statResponse.entries.find((entry) => entry.path === promptPath)?.exists ?? false
        if (!promptExists) {
          setPromptEnabled(false)
          setPromptContent('')
          return
        }
        const file = await desktopApi.fsReadFileFull(workspaceId, promptPath, 256 * 1024)
        if (cancelled) {
          return
        }
        setPromptEnabled(true)
        setPromptContent(file.content)
      } catch {
        if (!cancelled) {
          setPromptEnabled(false)
          setPromptContent('')
        }
      } finally {
        if (!cancelled) {
          setPromptPrefillLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activePromptWorkdir, customWorkdirEnabled, isEdit, open, promptDraftMode, provider, workspaceId])

  const handleFormModalKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') {
        return
      }
      if (event.nativeEvent.isComposing) {
        return
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        requestStandardModalClose('escape', onClose)
        return
      }

      const dialog = formDialogRef.current
      if (!dialog) {
        return
      }
      event.stopPropagation()
      trapModalTabFocus(event.nativeEvent, dialog)
    },
    [onClose],
  )

  if (!open) {
    return null
  }

  const providerOptions =
    availableProviders.length > 0
      ? availableProviders
      : providersLoaded
        ? []
        : [{ key: provider, label: resolveProviderLabel(provider), promptFileName }]

  const submitDisabled =
    saving ||
    deleting ||
    providersLoading ||
    promptPrefillLoading ||
    providerOptions.length === 0 ||
    !name.trim() ||
    (customWorkdirEnabled && !workdir.trim())

  return (
    <>
      <div
        className="settings-modal-backdrop"
        onKeyDown={handleFormModalKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            requestStandardModalClose('backdrop', onClose)
          }
        }}
      >
        <section
          ref={formDialogRef}
          className="settings-modal panel station-form-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="station-form-modal-title"
        >
          <header className="settings-modal-header">
            <div>
              <h2 id="station-form-modal-title">{copy.title}</h2>
              <p>{copy.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => requestStandardModalClose('explicit', onClose)}
              aria-label={t(locale, 'settingsModal.close')}
            >
              <AppIcon name="close" className="vb-icon" aria-hidden="true" />
            </button>
          </header>

          <section className="station-form-grid">
            <label className="station-form-field">
              <span>{locale === 'zh-CN' ? 'Agent 名称' : 'Agent Name'}</span>
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                disabled={saving || deleting}
                placeholder={copy.namePlaceholder}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!editingStation || workdir === buildDefaultAgentWorkdir(editingStation.name)) {
                    setWorkdir(buildDefaultAgentWorkdir(event.target.value || copy.defaultName))
                  }
                }}
              />
            </label>

            <label className="station-form-field">
              <span>{locale === 'zh-CN' ? 'Agent 工具类型' : 'Provider'}</span>
              <select
                value={provider}
                disabled={saving || deleting || providersLoading}
                onChange={(event) => setProvider(event.target.value as ManagedAgentProvider)}
              >
                {providerOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              {providersLoaded && providerOptions.length === 0 && (
                <p>
                  {locale === 'zh-CN'
                    ? '当前没有已配置或已安装的 Agent 供应商，请先到设置中完成供应商接入。'
                    : 'No configured or installed providers are available yet. Finish provider setup in Settings first.'}
                </p>
              )}
            </label>

            <div className="station-form-field">
              <span>{locale === 'zh-CN' ? '启动命令' : 'Launch Command'}</span>
              <input
                type="text"
                value={launchCommand}
                disabled={saving || deleting}
                placeholder={provider}
                onChange={(event) => setLaunchCommand(event.target.value)}
              />
              {providerHistoryCommands.length > 0 && (
                <div className="station-form-tag-chips">
                  {providerHistoryCommands.map((cmd) => (
                    <span key={cmd} className="station-form-tag-chip">
                      <button
                        type="button"
                        className="station-form-tag-chip-text"
                        disabled={saving || deleting}
                        title={cmd}
                        onClick={() => setLaunchCommand(cmd)}
                      >
                        {cmd.length > 24 ? `${cmd.slice(0, 21)}...` : cmd}
                      </button>
                      <button
                        type="button"
                        className="station-form-tag-chip-delete"
                        disabled={saving || deleting}
                        title={locale === 'zh-CN' ? '删除此条记录' : 'Delete this entry'}
                        onClick={(event) => {
                          event.stopPropagation()
                          const updated = deleteLaunchCommand(provider, cmd)
                          setLaunchCommandHistory(updated)
                        }}
                      >
                        <AppIcon name="close" className="vb-icon" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="station-form-field station-form-surface">
              <span>{locale === 'zh-CN' ? '工作目录模式' : 'Workdir Mode'}</span>
              <div className="station-form-segmented">
                <button
                  type="button"
                  className={`station-form-inline-action ${!customWorkdirEnabled ? 'active' : ''}`}
                  disabled={saving || deleting}
                  onClick={() => {
                    setCustomWorkdirEnabled(false)
                    setWorkdir(defaultWorkdir)
                  }}
                >
                  {locale === 'zh-CN' ? '工作区根目录' : 'Workspace Root'}
                </button>
                <button
                  type="button"
                  className={`station-form-inline-action ${customWorkdirEnabled ? 'active' : ''}`}
                  disabled={saving || deleting}
                  onClick={() => {
                    setCustomWorkdirEnabled(true)
                    setWorkdir((current) => {
                      const trimmed = current.trim()
                      if (trimmed && trimmed !== defaultWorkdir) {
                        return trimmed
                      }
                      return suggestedCustomWorkdir
                    })
                  }}
                >
                  {locale === 'zh-CN' ? '子目录' : 'Subdirectory'}
                </button>
              </div>
              <strong>{customWorkdirEnabled ? workdir.trim() || suggestedCustomWorkdir : defaultWorkdir}</strong>
            </div>

            <label className="station-form-field station-form-span-2">
              <span>{locale === 'zh-CN' ? '工作目录' : 'Work Directory'}</span>
              <p>
                {customWorkdirEnabled
                  ? locale === 'zh-CN'
                    ? '仅支持当前工作区内的相对路径。'
                    : 'Only workspace-relative paths inside the current workspace are allowed.'
                  : locale === 'zh-CN'
                    ? 'Agent 将直接从当前工作区根目录启动。'
                    : 'The agent will launch directly from the current workspace root.'}
              </p>
              <div className="station-form-workdir-row">
                <input
                  type="text"
                  value={customWorkdirEnabled ? workdir : defaultWorkdir}
                  disabled={saving || deleting || !customWorkdirEnabled}
                  placeholder={suggestedCustomWorkdir}
                  onChange={(event) => setWorkdir(event.target.value)}
                />
                <button
                  type="button"
                  className="station-form-workdir-picker"
                  aria-label={locale === 'zh-CN' ? '选择目录' : 'Select Directory'}
                  title={locale === 'zh-CN' ? '选择目录' : 'Select Directory'}
                  disabled={saving || deleting || !customWorkdirEnabled}
                  onClick={() => {
                    void (async () => {
                      const selected = await onPickWorkdir()
                      if (!selected) {
                        return
                      }
                      if (selected === '.') {
                        setCustomWorkdirEnabled(false)
                        setWorkdir(defaultWorkdir)
                        return
                      }
                      setCustomWorkdirEnabled(true)
                      if (selected) {
                        setWorkdir(selected)
                      }
                    })()
                  }}
                >
                  <AppIcon name="folder-open" className="vb-icon" aria-hidden="true" />
                </button>
              </div>
            </label>

            <div className="station-form-field station-form-span-2 station-form-surface">
              <span>{locale === 'zh-CN' ? '系统提示词文件' : 'System Prompt File'}</span>
              <strong>{promptFileName}</strong>
              <p>
                {promptEnabled
                  ? locale === 'zh-CN'
                    ? '保存时会在该 Agent 工作目录下创建或更新这个文件。'
                    : 'Saving will create or update this file inside the agent workdir.'
                  : locale === 'zh-CN'
                    ? '默认不会创建 Agent 私有提示词文件。'
                    : 'No agent-specific prompt file will be created by default.'}
              </p>
              {!isEdit && !customWorkdirEnabled && promptPrefillLoading && (
                <p>
                  {locale === 'zh-CN'
                    ? '正在检查工作区根目录下是否已有这个提示词文件。'
                    : 'Checking the workspace root for an existing prompt file.'}
                </p>
              )}
            </div>

            <div className="station-form-field station-form-span-2">
              <div className="station-form-heading-row">
                <span>{locale === 'zh-CN' ? '系统提示词' : 'System Prompt'}</span>
                <label className="station-form-checkbox">
                  <input
                    type="checkbox"
                    checked={promptEnabled}
                    disabled={saving || deleting || promptPrefillLoading}
                    onChange={(event) => {
                      setPromptDraftMode('manual')
                      setPromptEnabled(event.target.checked)
                    }}
                  />
                  <span>{locale === 'zh-CN' ? '启用 Agent 私有提示词文件' : 'Use agent prompt file'}</span>
                </label>
              </div>
              {promptEnabled && (
                <div className="station-form-prompt-editor">
                  <textarea
                    value={promptContent}
                    disabled={saving || deleting}
                    rows={8}
                    placeholder={
                      locale === 'zh-CN'
                        ? '系统提示词文件是 markdown 文件，为项目、你的个人工作流或整个组织为 Agents 提供持久指令。你用纯文本编写这些文件；Agent 在每个会话开始时读取它们。'
                        : 'System prompt files are markdown files that give Agent persistent instructions for a project, your personal workflow, or your entire organization. You write these files in plain text; Agent reads them at the start of every session.'
                    }
                    onChange={(event) => {
                      setPromptDraftMode('manual')
                      setPromptContent(event.target.value)
                    }}
                  />
                </div>
              )}
            </div>
          </section>

          <footer className="station-form-actions">
            {isEdit && onDelete && (
              <button
                type="button"
                className="station-form-btn danger"
                style={{ marginRight: 'auto' }}
                disabled={saving || deleting || deleteCleanupSubmitting}
                onClick={() => {
                  if (editingStation) {
                    void onDelete(editingStation.id)
                  }
                }}
              >
                <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
                <span>{deleting ? (locale === 'zh-CN' ? '删除中...' : 'Deleting...') : copy.deleteLabel}</span>
              </button>
            )}
            <button
              type="button"
              className="station-form-btn subtle"
              disabled={saving || deleting}
              onClick={() => requestStandardModalClose('explicit', onClose)}
            >
              {locale === 'zh-CN' ? '取消' : 'Cancel'}
            </button>
            <button
              type="button"
              className="station-form-btn"
              disabled={submitDisabled}
              onClick={() => {
                const payload = {
                  name: name.trim() || copy.defaultName,
                  tool: provider,
                  workdir: customWorkdirEnabled ? workdir.trim() : defaultWorkdir,
                  customWorkdir: customWorkdirEnabled,
                  promptEnabled,
                  promptContent: promptEnabled ? promptContent : '',
                  launchCommand: launchCommand.trim() || null,
                }
                if (launchCommand.trim() && launchCommand.trim() !== provider) {
                  const updatedHistory = recordLaunchCommand(provider, launchCommand.trim())
                  setLaunchCommandHistory(updatedHistory)
                }
                if (editingStation) {
                  void onSubmit({ id: editingStation.id, ...payload })
                  return
                }
                void onSubmit(payload)
              }}
            >
              <AppIcon name={isEdit ? 'check' : 'plus'} className="vb-icon" aria-hidden="true" />
              <span>
                {saving
                  ? locale === 'zh-CN'
                    ? '提交中...'
                    : 'Saving...'
                  : isEdit
                    ? locale === 'zh-CN'
                      ? '保存'
                      : 'Save'
                    : copy.submitLabel}
              </span>
            </button>
          </footer>
        </section>
      </div>

      <StationDeleteBindingCleanupDialog
        open={Boolean(deleteCleanupState)}
        locale={locale}
        state={deleteCleanupState}
        submitting={deleteCleanupSubmitting}
        onClose={() => onDeleteCleanupClose?.()}
        onStrategyChange={(strategy) => onDeleteCleanupStrategyChange?.(strategy)}
        onReplacementAgentChange={(agentId) => onDeleteCleanupReplacementChange?.(agentId)}
        onConfirm={() => onDeleteCleanupConfirm?.()}
      />
    </>
  )
}
