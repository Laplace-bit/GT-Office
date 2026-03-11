import { useEffect, useMemo, useState } from 'react'
import type { AgentRole } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { CreateStationInput, StationRole, UpdateStationInput } from './station-model'
import './StationManageModal.scss'

interface StationManageModalProps {
  open: boolean
  locale: Locale
  roles: AgentRole[]
  editingStation?: UpdateStationInput | null
  saving?: boolean
  deleting?: boolean
  onClose: () => void
  onPickWorkdir: () => Promise<string | null>
  onSubmit: (input: CreateStationInput | UpdateStationInput) => Promise<void> | void
  onDelete?: (stationId: string) => Promise<void> | void
}

const roleOptions: StationRole[] = ['manager', 'product', 'build', 'quality_release']

const roleKeyMap: Record<
  StationRole,
  | 'station.role.manager'
  | 'station.role.product'
  | 'station.role.build'
  | 'station.role.quality_release'
> = {
  manager: 'station.role.manager',
  product: 'station.role.product',
  build: 'station.role.build',
  quality_release: 'station.role.quality_release',
}

function roleLabel(locale: Locale, role: StationRole): string {
  return t(locale, roleKeyMap[role])
}

function defaultName(locale: Locale): string {
  return locale === 'zh-CN' ? '新角色' : 'New Role'
}

function defaultTool(): string {
  return 'codex cli'
}

function defaultWorkdir(): string {
  return '.gtoffice/org/custom/new-agent'
}

export function StationManageModal({
  open,
  locale,
  roles,
  editingStation,
  saving = false,
  deleting = false,
  onClose,
  onPickWorkdir,
  onSubmit,
  onDelete,
}: StationManageModalProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<StationRole>('product')
  const [tool, setTool] = useState(defaultTool)
  const [workdir, setWorkdir] = useState(defaultWorkdir)
  const editableRoles = useMemo(
    () =>
      roles.filter(
        (item): item is AgentRole & { roleKey: StationRole } =>
          roleOptions.includes(item.roleKey as StationRole) && item.status !== 'disabled',
      ),
    [roles],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    if (editingStation) {
      setName(editingStation.name)
      setRole(editingStation.role)
      setTool(editingStation.tool)
      setWorkdir(editingStation.workdir)
    } else {
      setName('')
      setRole('product')
      setTool(defaultTool())
      setWorkdir(defaultWorkdir())
    }
  }, [open, editingStation])

  const isEdit = Boolean(editingStation)
  const title = useMemo(() => {
    if (locale === 'zh-CN') return isEdit ? '编辑角色' : '新增角色'
    return isEdit ? 'Edit Role' : 'Create Role'
  }, [locale, isEdit])
  const subtitle = useMemo(
    () =>
      isEdit
        ? locale === 'zh-CN'
          ? '复用新增弹窗编辑角色，删除操作仅在编辑态显示。'
          : 'Reuse the creation modal for editing. Delete is only shown in edit mode.'
        : locale === 'zh-CN'
          ? '配置角色的核心属性与执行环境。'
          : 'Configure core role attributes and execution environment.',
    [isEdit, locale],
  )

  if (!open) {
    return null
  }

  return (
    <div
      className="settings-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="settings-modal panel station-form-modal" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, 'settingsModal.close')}>
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <section className="station-form-grid">
          <label>
            {locale === 'zh-CN' ? '名字' : 'Name'}
            <input
              type="text"
              value={name}
              disabled={saving || deleting}
              placeholder={locale === 'zh-CN' ? '例如：产品角色-09' : 'e.g. Product-09'}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label>
            {locale === 'zh-CN' ? '角色' : 'Role'}
            <select value={role} disabled={saving || deleting} onChange={(event) => setRole(event.target.value as StationRole)}>
              {(editableRoles.length > 0 ? editableRoles : roleOptions.map((item) => ({
                id: item,
                workspaceId: '',
                roleKey: item,
                roleName: roleLabel(locale, item),
                departmentId: '',
                charterPath: null,
                policyJson: null,
                version: 1,
                status: 'active' as const,
                isSystem: true,
                createdAtMs: 0,
                updatedAtMs: 0,
              }))).map((item) => (
                <option key={item.id} value={item.roleKey}>
                  {item.roleName}
                </option>
              ))}
            </select>
          </label>

          <label className="station-form-span-2">
            {locale === 'zh-CN' ? '工作目录' : 'Work Directory'}
            <div className="station-form-workdir-row">
              <input
                type="text"
                value={workdir}
                disabled={saving || deleting}
                placeholder={defaultWorkdir()}
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

          <label className="station-form-span-2">
            {locale === 'zh-CN' ? 'Agent 工具' : 'Agent Tool'}
            <input
              type="text"
              value={tool}
              disabled={saving || deleting}
              placeholder={defaultTool()}
              onChange={(event) => setTool(event.target.value)}
            />
          </label>
        </section>

        <footer className="station-form-actions">
          {isEdit && onDelete && (
            <button
              type="button"
              className="station-form-btn danger"
              style={{ marginRight: 'auto' }}
              disabled={saving || deleting}
              onClick={() => {
                if (editingStation) {
                  void onDelete(editingStation.id)
                }
              }}
            >
              <AppIcon name="trash" className="vb-icon" aria-hidden="true" />
              <span>{deleting ? (locale === 'zh-CN' ? '删除中...' : 'Deleting...') : locale === 'zh-CN' ? '删除角色' : 'Delete'}</span>
            </button>
          )}
          <button type="button" className="station-form-btn subtle" disabled={saving || deleting} onClick={onClose}>
            {locale === 'zh-CN' ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            className="station-form-btn"
            disabled={saving || deleting}
            onClick={() => {
              const payload = {
                name: name.trim() || defaultName(locale),
                role,
                tool: tool.trim() || defaultTool(),
                workdir: workdir.trim() || defaultWorkdir(),
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
                  : locale === 'zh-CN'
                    ? '创建角色'
                    : 'Create'}
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}
