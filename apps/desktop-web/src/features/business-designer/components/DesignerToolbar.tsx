import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerExportFormat } from '../model/designer-document'
import { DESIGNER_EXPORT_FORMATS } from '../model/designer-document'
import type { DesignerOperation } from '../model/designer-operation'
import {
  resolveDesignerToolbarActionStates,
  type DesignerCreateKind,
} from '../model/designer-toolbar-actions'

interface DesignerToolbarProps {
  locale: Locale
  canEdit: boolean
  dirty: boolean
  operation: DesignerOperation | null
  onSave: () => void
  onExport: (format: DesignerExportFormat) => void
  onCheckpoint: () => void
  onOpenHistory: () => void
  onCreateBlock: (kind: DesignerCreateKind) => void
}

export function DesignerToolbar({
  locale,
  canEdit,
  dirty,
  operation,
  onSave,
  onExport,
  onCheckpoint,
  onOpenHistory,
  onCreateBlock,
}: DesignerToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const actionStates = resolveDesignerToolbarActionStates({
    canEdit,
    operation,
  })

  useEffect(() => {
    if (exportOpen && actionStates.export.disabled) {
      setExportOpen(false)
    }
  }, [actionStates.export.disabled, exportOpen])

  useEffect(() => {
    if (!exportOpen) {
      return
    }
    const handle = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [exportOpen])

  useEffect(() => {
    if (!exportOpen) {
      return
    }
    exportRef.current?.querySelector<HTMLButtonElement>('.designer-export-option')?.focus()
  }, [exportOpen])

  const handleExportMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End' &&
      event.key !== 'Escape'
    ) {
      return
    }
    event.preventDefault()
    if (event.key === 'Escape') {
      setExportOpen(false)
      exportButtonRef.current?.focus({ preventScroll: true })
      return
    }
    const buttons = Array.from(
      exportRef.current?.querySelectorAll<HTMLButtonElement>('.designer-export-option') ?? [],
    )
    if (buttons.length === 0) return
    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowDown'
            ? (Math.max(0, currentIndex) + 1) % buttons.length
            : (currentIndex <= 0 ? buttons.length : currentIndex) - 1
    buttons[nextIndex]?.focus()
  }

  return (
    <header className="designer-toolbar" role="toolbar" aria-label={t(locale, 'designer.toolbar')}>
      <button
        type="button"
        className="designer-tool-button"
        onClick={onSave}
        disabled={actionStates.save.disabled}
        title={actionStates.save.busy ? t(locale, 'designer.saving') : t(locale, 'designer.save')}
        aria-label={actionStates.save.busy ? t(locale, 'designer.saving') : t(locale, 'designer.save')}
      >
        <AppIcon name="check" aria-hidden="true" />
        <span>{actionStates.save.busy ? t(locale, 'designer.saving') : t(locale, 'designer.save')}</span>
      </button>

      <span className="designer-tool-divider" aria-hidden="true" />

      <button
        type="button"
        className="designer-tool-button"
        onClick={() => onCreateBlock('entityModel')}
        disabled={actionStates.createEntity.disabled}
        title={t(locale, 'designer.create.entity')}
        aria-label={t(locale, 'designer.create.entity')}
      >
        <AppIcon name="database" aria-hidden="true" />
        <span>{t(locale, 'designer.create.entity')}</span>
      </button>
      <button
        type="button"
        className="designer-tool-button"
        onClick={() => onCreateBlock('businessFlow')}
        disabled={actionStates.createFlow.disabled}
        title={t(locale, 'designer.create.flow')}
        aria-label={t(locale, 'designer.create.flow')}
      >
        <AppIcon name="route" aria-hidden="true" />
        <span>{t(locale, 'designer.create.flow')}</span>
      </button>
      <button
        type="button"
        className="designer-tool-button"
        onClick={() => onCreateBlock('apiContract')}
        disabled={actionStates.createApi.disabled}
        title={t(locale, 'designer.create.api')}
        aria-label={t(locale, 'designer.create.api')}
      >
        <AppIcon name="braces" aria-hidden="true" />
        <span>{t(locale, 'designer.create.api')}</span>
      </button>

      <span className="designer-tool-divider" aria-hidden="true" />

      <span className="designer-tool-spacer" />

      <div className="designer-export-menu" ref={exportRef}>
        <button
          ref={exportButtonRef}
          type="button"
          className="designer-tool-button"
          onClick={() => setExportOpen((open) => !open)}
          disabled={actionStates.export.disabled}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          aria-controls={exportOpen ? 'designer-export-menu' : undefined}
          title={actionStates.export.busy ? t(locale, 'designer.exporting') : t(locale, 'designer.export')}
          aria-label={actionStates.export.busy ? t(locale, 'designer.exporting') : t(locale, 'designer.export')}
        >
          <AppIcon name="cloud-download" aria-hidden="true" />
          <span>
            {actionStates.export.busy ? t(locale, 'designer.exporting') : t(locale, 'designer.export')}
          </span>
          <AppIcon name="chevron-down" aria-hidden="true" />
        </button>
        {exportOpen ? (
          <div
            id="designer-export-menu"
            className="designer-export-popover"
            role="menu"
            onKeyDown={handleExportMenuKeyDown}
          >
            {DESIGNER_EXPORT_FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                className="designer-export-option"
                role="menuitem"
                onClick={() => {
                  setExportOpen(false)
                  onExport(format)
                }}
              >
                {t(locale, `designer.exportFormat.${format}` as 'designer.exportFormat.markdown')}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="designer-tool-button"
        onClick={onCheckpoint}
        disabled={actionStates.checkpoint.disabled}
        title={t(locale, 'designer.checkpointHint')}
        aria-label={actionStates.checkpoint.busy ? t(locale, 'designer.checkpointing') : t(locale, 'designer.checkpoint')}
      >
        <AppIcon name="git-commit" aria-hidden="true" />
        <span>
          {actionStates.checkpoint.busy
            ? t(locale, 'designer.checkpointing')
            : t(locale, 'designer.checkpoint')}
        </span>
      </button>

      <button
        type="button"
        className="designer-tool-button"
        onClick={onOpenHistory}
        disabled={actionStates.history.disabled}
        title={t(locale, 'designer.history.hint')}
        aria-label={t(locale, 'designer.history.button')}
      >
        <AppIcon name="clock" aria-hidden="true" />
        <span>{t(locale, 'designer.history.button')}</span>
      </button>

      {dirty ? <span className="designer-tool-dirty">{t(locale, 'designer.dirtyDot')}</span> : null}
    </header>
  )
}
