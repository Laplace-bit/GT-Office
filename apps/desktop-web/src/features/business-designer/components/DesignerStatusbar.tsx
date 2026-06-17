import { t, type Locale } from '@shell/i18n/ui-locale'
import type { DesignerOperation, DesignerNotice } from '../controllers/useDesignerDocumentState'

interface DesignerStatusbarProps {
  locale: Locale
  dirty: boolean
  operation: DesignerOperation | null
  status: string | null
  schemaVersion: number | null
  diagnosticCount: number
  scaffoldInitialized: boolean
  notice: DesignerNotice | null
}

function operationLabel(locale: Locale, operation: DesignerOperation): string {
  switch (operation) {
    case 'save':
      return t(locale, 'designer.saving')
    case 'agent':
      return t(locale, 'designer.agentRunning')
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
    case 'exported':
      return t(locale, 'designer.exportedNotice')
    case 'exportCancelled':
      return t(locale, 'designer.exportCancelledNotice')
    case 'agentReady':
      return t(locale, 'designer.agentReadyNotice')
    case 'applied':
      return t(locale, 'designer.appliedNotice')
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
  scaffoldInitialized,
  notice,
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
      {diagnosticCount > 0 ? (
        <span className="designer-statusbar-diagnostics">
          {t(locale, 'designer.diagnostics', { count: diagnosticCount })}
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
