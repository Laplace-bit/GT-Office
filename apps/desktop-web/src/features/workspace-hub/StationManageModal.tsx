import { useEffect, useMemo, useState } from 'react'

import {
  desktopApi,
  type AgentRole,
  type AgentRoleScope,
} from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { requestStandardModalClose } from '@/components/modal/standard-modal-close'

import type { CreateStationInput, UpdateStationInput } from './station-model'
import {
  buildDefaultAgentWorkdir,
  resolveAvailableAgentProviders,
  resolveManagedProviderKey,
  resolvePromptFileNameForProvider,
  resolveProviderLabel,
  type ManagedAgentProvider,
} from './agent-management-model'
import { StationDeleteBindingCleanupDialog } from './StationDeleteBindingCleanupDialog'
import type {
  StationDeleteCleanupState,
  StationDeleteCleanupStrategy,
} from './station-delete-binding-cleanup-model'
import { resolveStationManageModalCopy } from './station-manage-copy'

import './StationManageModal.scss'

interface StationManageModalProps {
  open: boolean
  locale: Locale
  workspaceId?: string | null
  roles: AgentRole[]
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

interface RoleManageModalProps {
  open: boolean
  locale: Locale
  workspaceId?: string | null
  roles: AgentRole[]
  onClose: () => void
  onChanged?: () => Promise<void> | void
}

function sortRoles(roles: AgentRole[]): AgentRole[] {
  return [...roles].sort((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope === 'workspace' ? -1 : 1
    }
    return left.roleName.localeCompare(right.roleName)
  })
}

function resolveEffectiveRoles(roles: AgentRole[]): AgentRole[] {
  const effective = new Map<string, AgentRole>()
  for (const role of sortRoles(roles.filter((item) => item.status !== 'disabled'))) {
    if (!effective.has(role.roleKey)) {
      effective.set(role.roleKey, role)
    }
  }
  return [...effective.values()]
}

function RoleManageModal({
  open,
  locale,
  workspaceId,
  roles,
  onClose,
  onChanged,
}: RoleManageModalProps) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [roleName, setRoleName] = useState('')
  const [scope, setScope] = useState<AgentRoleScope>('workspace')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const sortedRoles = useMemo(() => sortRoles(roles), [roles])
  const selectedRole = useMemo(
    () => sortedRoles.find((role) => role.id === selectedRoleId) ?? null,
    [selectedRoleId, sortedRoles],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    if (selectedRole) {
      setRoleName(selectedRole.roleName)
      setScope(selectedRole.scope)
      return
    }
    setRoleName('')
    setScope('workspace')
  }, [open, selectedRole])

  if (!open) {
    return null
  }

  const canManage = Boolean(workspaceId && desktopApi.isTauriRuntime())

  return (
    <div
      className="settings-modal-backdrop station-role-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestStandardModalClose('backdrop', onClose)
        }
      }}
    >
      <section className="settings-modal panel station-role-modal" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div>
            <h2>{locale === 'zh-CN' ? '角色管理' : 'Role Management'}</h2>
            <p>
              {locale === 'zh-CN'
                ? '支持新增、编辑、删除角色；工作区角色优先覆盖全局角色。'
                : 'Create, edit, and delete roles. Workspace roles override global roles.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestStandardModalClose('explicit', onClose)}
            aria-label={t(locale, 'settingsModal.close')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <section className="station-role-modal__body">
          <div className="station-role-modal__list">
            <button
              type="button"
              className={`station-role-modal__list-item ${selectedRoleId === null ? 'is-active' : ''}`}
              onClick={() => setSelectedRoleId(null)}
            >
              <strong>{locale === 'zh-CN' ? '新增角色' : 'New Role'}</strong>
              <span>{locale === 'zh-CN' ? '创建一个新的全局或工作区角色' : 'Create a new global or workspace role'}</span>
            </button>
            {sortedRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                className={`station-role-modal__list-item ${selectedRoleId === role.id ? 'is-active' : ''}`}
                onClick={() => setSelectedRoleId(role.id)}
              >
                <strong>{role.roleName}</strong>
                <span>{role.scope === 'global' ? 'Global' : 'Workspace'}</span>
              </button>
            ))}
          </div>

          <div className="station-role-modal__editor">
            <label className="station-form-field">
              <span>{locale === 'zh-CN' ? '角色名称' : 'Role Name'}</span>
              <input
                type="text"
                value={roleName}
                disabled={!canManage || saving || deleting}
                placeholder={locale === 'zh-CN' ? '例如：架构师' : 'e.g. Architect'}
                onChange={(event) => setRoleName(event.target.value)}
              />
            </label>

            <label className="station-form-field">
              <span>{locale === 'zh-CN' ? '作用域' : 'Scope'}</span>
              <select
                value={scope}
                disabled={!canManage || saving || deleting}
                onChange={(event) => setScope(event.target.value as AgentRoleScope)}
              >
                <option value="workspace">{locale === 'zh-CN' ? '仅当前工作区' : 'Workspace only'}</option>
                <option value="global">{locale === 'zh-CN' ? '全局' : 'Global'}</option>
              </select>
            </label>

            <div className="station-role-modal__hint">
              {locale === 'zh-CN'
                ? '删除已被 Agent 使用的角色时，系统会阻止并提示先迁移。'
                : 'Deleting a role that is still assigned to agents will be blocked.'}
            </div>
          </div>
        </section>

        <footer className="station-form-actions">
          {selectedRole && (
            <button
              type="button"
              className="station-form-btn danger"
              style={{ marginRight: 'auto' }}
              disabled={!canManage || saving || deleting}
              onClick={() => {
                if (!workspaceId || !selectedRole) {
                  return
                }
                void (async () => {
                  setDeleting(true)
                  try {
                    await desktopApi.agentRoleDelete({
                      workspaceId,
                      roleId: selectedRole.id,
                      scope: selectedRole.scope,
                    })
                    await onChanged?.()
                    setSelectedRoleId(null)
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : String(error))
                  } finally {
                    setDeleting(false)
                  }
                })()
              }}
            >
              <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
              <span>{locale === 'zh-CN' ? '删除角色' : 'Delete Role'}</span>
            </button>
          )}
          <button
            type="button"
            className="station-form-btn subtle"
            onClick={() => requestStandardModalClose('explicit', onClose)}
          >
            {locale === 'zh-CN' ? '关闭' : 'Close'}
          </button>
          <button
            type="button"
            className="station-form-btn"
            disabled={!canManage || !roleName.trim() || saving || deleting}
            onClick={() => {
              if (!workspaceId) {
                return
              }
              void (async () => {
                setSaving(true)
                try {
                  await desktopApi.agentRoleSave({
                    workspaceId,
                    roleId: selectedRole?.id ?? null,
                    roleKey: selectedRole?.roleKey ?? null,
                    roleName: roleName.trim(),
                    scope,
                  })
                  await onChanged?.()
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : String(error))
                } finally {
                  setSaving(false)
                }
              })()
            }}
          >
            <AppIcon name={selectedRole ? 'check' : 'plus'} className="vb-icon" aria-hidden="true" />
            <span>{selectedRole ? (locale === 'zh-CN' ? '保存角色' : 'Save Role') : locale === 'zh-CN' ? '新增角色' : 'Add Role'}</span>
          </button>
        </footer>
      </section>
    </div>
  )
}

export function StationManageModal({
  open,
  locale,
  workspaceId,
  roles,
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
  onRolesChanged,
}: StationManageModalProps) {
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [provider, setProvider] = useState<ManagedAgentProvider>('codex')
  const [workdir, setWorkdir] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [availableProviders, setAvailableProviders] = useState<
    ReturnType<typeof resolveAvailableAgentProviders>
  >([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [roleManagerOpen, setRoleManagerOpen] = useState(false)

  const isEdit = Boolean(editingStation)
  const copy = useMemo(() => resolveStationManageModalCopy(locale, isEdit), [isEdit, locale])
  const effectiveRoles = useMemo(() => resolveEffectiveRoles(roles), [roles])
  const selectedRole = useMemo(
    () => effectiveRoles.find((role) => role.id === roleId) ?? effectiveRoles[0] ?? null,
    [effectiveRoles, roleId],
  )
  const defaultWorkdir = useMemo(
    () => buildDefaultAgentWorkdir(name.trim() || copy.defaultName),
    [copy.defaultName, name],
  )
  const promptFileName = resolvePromptFileNameForProvider(provider)

  useEffect(() => {
    if (!open) {
      return
    }
    const nextRole = editingStation?.roleId ?? effectiveRoles[0]?.id ?? ''
    setName(editingStation?.name ?? '')
    setRoleId(nextRole)
    setProvider(resolveManagedProviderKey(editingStation?.tool))
    setWorkdir(editingStation?.workdir ?? buildDefaultAgentWorkdir(copy.defaultName))
    setPromptContent('')
  }, [copy.defaultName, editingStation, effectiveRoles, open])

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
        }
      } catch {
        if (!cancelled) {
          setPromptContent('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editingStation, open, workspaceId])

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
    !selectedRole ||
    providersLoading ||
    providerOptions.length === 0 ||
    !name.trim()

  return (
    <>
      <div
        className="settings-modal-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            requestStandardModalClose('backdrop', onClose)
          }
        }}
      >
        <section className="settings-modal panel station-form-modal" role="dialog" aria-modal="true">
          <header className="settings-modal-header">
            <div>
              <h2>{copy.title}</h2>
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

            <label className="station-form-field">
              <span>{locale === 'zh-CN' ? '角色' : 'Role'}</span>
              <div className="station-form-inline-row">
                <select
                  value={selectedRole?.id ?? ''}
                  disabled={saving || deleting || effectiveRoles.length === 0}
                  onChange={(event) => setRoleId(event.target.value)}
                >
                  {effectiveRoles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.roleName} {item.scope === 'global' ? '(Global)' : '(Workspace)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="station-form-inline-action"
                  disabled={!workspaceId}
                  onClick={() => setRoleManagerOpen(true)}
                >
                  {locale === 'zh-CN' ? '管理' : 'Manage'}
                </button>
              </div>
            </label>

            <div className="station-form-field station-form-surface">
              <span>{locale === 'zh-CN' ? '默认工作目录' : 'Default Workdir'}</span>
              <strong>{defaultWorkdir}</strong>
            </div>

            <label className="station-form-field station-form-span-2">
              <span>{locale === 'zh-CN' ? '工作目录' : 'Work Directory'}</span>
              <div className="station-form-workdir-row">
                <input
                  type="text"
                  value={workdir}
                  disabled={saving || deleting}
                  placeholder={defaultWorkdir}
                  onChange={(event) => setWorkdir(event.target.value)}
                />
                <button
                  type="button"
                  className="station-form-workdir-picker"
                  aria-label={locale === 'zh-CN' ? '选择目录' : 'Select Directory'}
                  title={locale === 'zh-CN' ? '选择目录' : 'Select Directory'}
                  disabled={saving || deleting}
                  onClick={() => {
                    void (async () => {
                      const selected = await onPickWorkdir()
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
                {locale === 'zh-CN'
                  ? '保存时会在该 Agent 工作目录下自动创建或更新这个文件。留空会写入默认说明。'
                  : 'Saving will create or update this file inside the agent workdir. Leaving it blank writes the default note.'}
              </p>
            </div>

            <label className="station-form-field station-form-span-2">
              <span>{locale === 'zh-CN' ? '系统提示词' : 'System Prompt'}</span>
              <textarea
                value={promptContent}
                disabled={saving || deleting}
                rows={8}
                placeholder={
                  locale === 'zh-CN'
                    ? '留空即可，系统会自动写入说明文本。'
                    : 'Leave blank to let the app write the default note.'
                }
                onChange={(event) => setPromptContent(event.target.value)}
              />
            </label>
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
                if (!selectedRole) {
                  return
                }
                const payload = {
                  name: name.trim() || copy.defaultName,
                  roleId: selectedRole.id,
                  role: selectedRole.roleKey,
                  roleName: selectedRole.roleName,
                  tool: provider,
                  workdir: workdir.trim() || defaultWorkdir,
                  customWorkdir: (workdir.trim() || defaultWorkdir) !== defaultWorkdir,
                  promptContent,
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

      <RoleManageModal
        open={roleManagerOpen}
        locale={locale}
        workspaceId={workspaceId}
        roles={roles}
        onClose={() => setRoleManagerOpen(false)}
        onChanged={async () => {
          await onRolesChanged?.()
        }}
      />

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
