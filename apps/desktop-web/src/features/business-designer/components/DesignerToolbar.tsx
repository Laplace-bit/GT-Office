import { useEffect, useRef, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerExportFormat } from '../model/designer-document'
import { DESIGNER_EXPORT_FORMATS } from '../model/designer-document'
import type { DesignerOperation } from '../controllers/useDesignerDocumentState'

interface DesignerToolbarProps {
  locale: Locale
  canEdit: boolean
  dirty: boolean
  operation: DesignerOperation | null
  onSave: () => void
  onRunAgent: () => void
  onExport: (format: DesignerExportFormat) => void
  onCheckpoint: () => void
  onOpenHistory: () => void
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
  onRunAgent,
  onExport,
  onCheckpoint,
  onOpenHistory,
}: DesignerToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false)
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
        className="designer-tool-button designer-tool-button--accent"
        onClick={onRunAgent}
        disabled={!canEdit || anyBusy(operation)}
        title={t(locale, 'designer.agentHint')}
      >
        <AppIcon name="sparkles" aria-hidden="true" />
        <span>
          {busy(operation, 'agent')
            ? t(locale, 'designer.agentRunning')
            : t(locale, 'designer.agent')}
        </span>
      </button>

      <span className="designer-tool-spacer" />

      <div className="designer-export-menu" ref={exportRef}>
        <button
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
          <div className="designer-export-popover" role="menu">
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
