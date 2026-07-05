import { t, type Locale } from '@shell/i18n/ui-locale'
import type { DesignerNotice } from '../controllers/useDesignerDocumentState'
import type { DesignerOperation } from '../model/designer-operation'

interface DesignerStatusbarProps {
  locale: Locale
  dirty: boolean
  operation: DesignerOperation | null
  status: string | null
  schemaVersion: number | null
  diagnosticCount: number
  /** v1: total gap count across the document. */
  gapCount: number
  scaffoldInitialized: boolean
  notice: DesignerNotice | null
  onSaveExternalChange?: () => void
  onDiscardExternalChange?: () => void
}

function operationLabel(locale: Locale, operation: DesignerOperation): string {
  switch (operation) {
    case 'save':
      return t(locale, 'designer.saving')
    case 'agent':
      return t(locale, 'designer.agentRunning')
    case 'recover':
      return t(locale, 'designer.agentRecovering')
    case 'apply':
      return t(locale, 'designer.applying')
    case 'compile':
      return t(locale, 'designer.compiling')
    case 'checkpoint':
      return t(locale, 'designer.checkpointing')
    case 'export':
      return t(locale, 'designer.exporting')
    case 'validate':
      return t(locale, 'designer.validating')
    case 'load':
      return t(locale, 'designer.loading')
    default:
      return ''
  }
}

function noticeText(locale: Locale, notice: DesignerNotice): string {
  switch (notice.text) {
    case 'saved':
      return t(locale, 'designer.savedNotice')
    case 'compiled':
      return t(locale, 'designer.compiledNotice')
    case 'checkpointed':
      return t(locale, 'designer.checkpointedNotice')
    case 'checkpointReverted':
      return t(locale, 'designer.checkpointRevertedNotice')
    case 'exported':
      return t(locale, 'designer.exportedNotice')
    case 'exportCancelled':
      return t(locale, 'designer.exportCancelledNotice')
    case 'agentReady':
      return t(locale, 'designer.agentReadyNotice')
    case 'agentDispatched':
      return t(locale, 'designer.agentDispatchedNotice')
    case 'applied':
      return t(locale, 'designer.appliedNotice')
    case 'externalChangePending':
      return t(locale, 'designer.externalChangePendingNotice')
    default:
      return notice.text
  }
}

export function DesignerStatusbar({
  locale,
  dirty,
  operation,
  status,
  schemaVersion,
  diagnosticCount,
  gapCount,
  scaffoldInitialized,
  notice,
  onSaveExternalChange,
  onDiscardExternalChange,
}: DesignerStatusbarProps) {
  const left = operation
    ? operationLabel(locale, operation)
    : notice
      ? noticeText(locale, notice)
      : dirty
        ? t(locale, 'designer.unsaved')
        : t(locale, 'designer.allSaved')

  return (
    <footer className="designer-statusbar" role="contentinfo">
      <span className={`designer-statusbar-state ${dirty ? 'is-dirty' : 'is-clean'}`}>{left}</span>
      {status ? <span className="designer-statusbar-status">{status}</span> : null}
      {schemaVersion ? (
        <span className="designer-statusbar-schema">
          {t(locale, 'designer.schemaVersion', { version: schemaVersion })}
        </span>
      ) : null}
      <span className={`designer-statusbar-gaps ${gapCount === 0 ? 'is-clean' : ''}`}>
        {gapCount === 0
          ? t(locale, 'designer.statusbar.gapsClean')
          : t(locale, 'designer.statusbar.gaps', {
              count: gapCount,
              plural: gapCount === 1 ? '' : 's',
            })}
      </span>
      {diagnosticCount > 0 ? (
        <span className="designer-statusbar-diagnostics">
          {t(locale, 'designer.diagnostics', { count: diagnosticCount })}
        </span>
      ) : null}
      {notice?.text === 'externalChangePending' ? (
        <span className="designer-statusbar-actions">
          <button type="button" className="designer-statusbar-action" onClick={onSaveExternalChange}>
            {t(locale, 'designer.externalChange.saveLocal')}
          </button>
          <button type="button" className="designer-statusbar-action" onClick={onDiscardExternalChange}>
            {t(locale, 'designer.externalChange.discardLocal')}
          </button>
        </span>
      ) : null}
      <span className="designer-statusbar-spacer" />
      <span className={`designer-statusbar-repo ${scaffoldInitialized ? 'is-ready' : ''}`}>
        {scaffoldInitialized
          ? t(locale, 'designer.docsReady')
          : t(locale, 'designer.docsNotReady')}
      </span>
    </footer>
  )
}
