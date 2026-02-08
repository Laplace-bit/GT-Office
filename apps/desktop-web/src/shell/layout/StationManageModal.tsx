import { useEffect, useMemo, useState } from 'react'
import { t, type Locale } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import type { CreateStationInput, StationRole } from './model'

interface StationManageModalProps {
  open: boolean
  locale: Locale
  onClose: () => void
  onPickWorkdir: () => Promise<string | null>
  onSubmit: (input: CreateStationInput) => void
}

const roleOptions: StationRole[] = ['implementation', 'review', 'test', 'release']

const roleKeyMap: Record<StationRole, 'station.role.implementation' | 'station.role.review' | 'station.role.test' | 'station.role.release'> = {
  implementation: 'station.role.implementation',
  review: 'station.role.review',
  test: 'station.role.test',
  release: 'station.role.release',
}

function roleLabel(locale: Locale, role: StationRole): string {
  return t(locale, roleKeyMap[role])
}

function defaultName(locale: Locale): string {
  return locale === 'zh-CN' ? '新岗位' : 'New Station'
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
  onClose,
  onPickWorkdir,
  onSubmit,
}: StationManageModalProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<StationRole>('implementation')
  const [tool, setTool] = useState(defaultTool)
  const [workdir, setWorkdir] = useState(defaultWorkdir)

  useEffect(() => {
    if (!open) {
      return
    }
    setName('')
    setRole('implementation')
    setTool(defaultTool())
    setWorkdir(defaultWorkdir())
  }, [open])

  const title = useMemo(() => (locale === 'zh-CN' ? '新增岗位' : 'Create Station'), [locale])
  const subtitle = useMemo(
    () =>
      locale === 'zh-CN'
        ? '统一管理岗位与中央工位，提交后自动同步。'
        : 'Manage role and central station in one place. Submit to sync.',
    [locale],
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
              placeholder={locale === 'zh-CN' ? '例如：实现岗-09' : 'e.g. Implementation-09'}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label>
            {locale === 'zh-CN' ? '岗位' : 'Role'}
            <select value={role} onChange={(event) => setRole(event.target.value as StationRole)}>
              {roleOptions.map((item) => (
                <option key={item} value={item}>
                  {roleLabel(locale, item)}
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
                placeholder={defaultWorkdir()}
                onChange={(event) => setWorkdir(event.target.value)}
              />
              <button
                type="button"
                className="station-form-workdir-picker"
                aria-label={locale === 'zh-CN' ? '选择目录' : 'Select Directory'}
                title={locale === 'zh-CN' ? '选择目录' : 'Select Directory'}
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
              placeholder={defaultTool()}
              onChange={(event) => setTool(event.target.value)}
            />
          </label>
        </section>

        <footer className="station-form-actions">
          <button type="button" className="station-form-btn subtle" onClick={onClose}>
            {locale === 'zh-CN' ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            className="station-form-btn"
            onClick={() => {
              onSubmit({
                name: name.trim() || defaultName(locale),
                role,
                tool: tool.trim() || defaultTool(),
                workdir: workdir.trim() || defaultWorkdir(),
              })
              onClose()
            }}
          >
            <AppIcon name="plus" className="vb-icon" aria-hidden="true" />
            <span>{locale === 'zh-CN' ? '创建岗位' : 'Create'}</span>
          </button>
        </footer>
      </section>
    </div>
  )
}
