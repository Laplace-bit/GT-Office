import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerExportFormat } from '../model/designer-document'
import { DESIGNER_EXPORT_FORMATS } from '../model/designer-document'
import type { DesignerOperation } from '../controllers/useDesignerDocumentState'

export type DesignerCreateKind = 'entityModel' | 'businessFlow' | 'apiContract'

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
  onExpandCanvas: (userPrompt?: string | null) => void
}

function busy(operation: DesignerOperation | null, target: DesignerOperation): boolean {
  return operation === target
}

function anyBusy(operation: DesignerOperation | null): boolean {
  return operation !== null
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
  onExpandCanvas,
}: DesignerToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false)
  const [expandPrompt, setExpandPrompt] = useState('')
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

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
        disabled={!canEdit || busy(operation, 'save')}
      >
        <AppIcon name="check" aria-hidden="true" />
        <span>{busy(operation, 'save') ? t(locale, 'designer.saving') : t(locale, 'designer.save')}</span>
      </button>

      <span className="designer-tool-divider" aria-hidden="true" />

      <button
        type="button"
        className="designer-tool-button"
        onClick={() => onCreateBlock('entityModel')}
        disabled={!canEdit}
        title={t(locale, 'designer.create.entity')}
      >
        <AppIcon name="database" aria-hidden="true" />
        <span>{t(locale, 'designer.create.entity')}</span>
      </button>
      <button
        type="button"
        className="designer-tool-button"
        onClick={() => onCreateBlock('businessFlow')}
        disabled={!canEdit}
        title={t(locale, 'designer.create.flow')}
      >
        <AppIcon name="route" aria-hidden="true" />
        <span>{t(locale, 'designer.create.flow')}</span>
      </button>
      <button
        type="button"
        className="designer-tool-button"
        onClick={() => onCreateBlock('apiContract')}
        disabled={!canEdit}
        title={t(locale, 'designer.create.api')}
      >
        <AppIcon name="braces" aria-hidden="true" />
        <span>{t(locale, 'designer.create.api')}</span>
      </button>
      <button
        type="button"
        className="designer-tool-button designer-tool-button--accent"
        onClick={() => {
          onExpandCanvas(expandPrompt.trim() || null)
          setExpandPrompt('')
        }}
        disabled={!canEdit || anyBusy(operation)}
        title={t(locale, 'designer.freeform.expandCanvas')}
      >
        <AppIcon name="sparkles" aria-hidden="true" />
        <span>{t(locale, 'designer.freeform.expandCanvas')}</span>
      </button>
      <input
        className="designer-toolbar-prompt"
        value={expandPrompt}
        disabled={!canEdit || anyBusy(operation)}
        aria-label={t(locale, 'designer.freeform.userPrompt')}
        placeholder={t(locale, 'designer.freeform.toolbarPromptPlaceholder')}
        onChange={(event) => setExpandPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !canEdit || anyBusy(operation)) {
            return
          }
          event.preventDefault()
          onExpandCanvas(expandPrompt.trim() || null)
          setExpandPrompt('')
        }}
      />

      <span className="designer-tool-divider" aria-hidden="true" />

      <span className="designer-tool-spacer" />

      <div className="designer-export-menu" ref={exportRef}>
        <button
          ref={exportButtonRef}
          type="button"
          className="designer-tool-button"
          onClick={() => setExportOpen((open) => !open)}
          disabled={!canEdit || anyBusy(operation)}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
        >
          <AppIcon name="cloud-download" aria-hidden="true" />
          <span>
            {busy(operation, 'export') ? t(locale, 'designer.exporting') : t(locale, 'designer.export')}
          </span>
          <AppIcon name="chevron-down" aria-hidden="true" />
        </button>
        {exportOpen ? (
          <div
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
        disabled={!canEdit || busy(operation, 'checkpoint')}
        title={t(locale, 'designer.checkpointHint')}
      >
        <AppIcon name="git-commit" aria-hidden="true" />
        <span>
          {busy(operation, 'checkpoint')
            ? t(locale, 'designer.checkpointing')
            : t(locale, 'designer.checkpoint')}
        </span>
      </button>

      <button
        type="button"
        className="designer-tool-button"
        onClick={onOpenHistory}
        disabled={!canEdit}
        title={t(locale, 'designer.history.hint')}
      >
        <AppIcon name="clock" aria-hidden="true" />
        <span>{t(locale, 'designer.history.button')}</span>
      </button>

      {dirty ? <span className="designer-tool-dirty">{t(locale, 'designer.dirtyDot')}</span> : null}
    </header>
  )
}
