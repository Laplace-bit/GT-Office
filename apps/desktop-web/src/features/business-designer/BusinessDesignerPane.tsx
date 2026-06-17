import { useEffect } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { useDesignerDocuments } from './controllers/useDesignerDocuments'
import { useDesignerDocumentState } from './controllers/useDesignerDocumentState'
import { useDesignerHistory } from './controllers/useDesignerHistory'
import { DesignerSidebar } from './components/DesignerSidebar'
import { DesignerToolbar } from './components/DesignerToolbar'
import { DesignerDocument } from './components/DesignerDocument'
import { DesignerPatchSheet } from './components/DesignerPatchSheet'
import { DesignerHistorySheet } from './components/DesignerHistorySheet'
import { DesignerStatusbar } from './components/DesignerStatusbar'
import { DESIGNER_SCHEMA_VERSION } from './model/designer-document'

interface BusinessDesignerPaneProps {
  locale: Locale
  workspaceId: string | null
  workspaceRoot: string | null
  active: boolean
}

export function BusinessDesignerPane({
  locale,
  workspaceId,
  workspaceRoot,
  active,
}: BusinessDesignerPaneProps) {
  const documents = useDesignerDocuments({ workspaceId, active })
  const state = useDesignerDocumentState({
    workspaceId,
    selectedDocumentId: documents.selectedDocumentId,
    active,
  })
  const history = useDesignerHistory({
    workspaceId,
    documentId: state.detail?.manifest.documentId ?? null,
    active,
  })

  // Auto-dismiss transient notices after a short delay so the statusbar doesn't
  // cling to stale "saved" text. (T4: don't show chrome for fast operations.)
  useEffect(() => {
    if (!state.notice) {
      return
    }
    const handle = window.setTimeout(() => state.clearNotice(), 2600)
    return () => window.clearTimeout(handle)
  }, [state.notice, state.clearNotice])

  const createDocument = (params: { documentId: string; title: string; module?: string | null }) => {
    void documents
      .createDocument({ documentId: params.documentId, title: params.title, module: params.module ?? null })
      .then((detail) => {
        if (detail) {
          state.replaceDetail(detail)
        }
      })
  }

  const workspaceReady = Boolean(workspaceId)
  const canEdit = Boolean(state.detail)
  const briefMarkdown =
    (state.brief?.payload as { markdown?: string } | undefined)?.markdown ?? ''
  const onBriefChange = (markdown: string) => {
    if (state.brief) {
      state.updateBlock(state.brief.id, { payload: { markdown } })
    }
  }
  const onTitleChange = (title: string) => {
    if (state.detail) {
      state.replaceDetail(
        { ...state.detail, manifest: { ...state.detail.manifest, title } },
        true,
      )
    }
  }

  const error = documents.error ?? state.error

  return (
    <div className="business-designer-pane">
      {error ? (
        <div className="designer-error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {workspaceReady ? (
        <div className="designer-workbench">
          <DesignerSidebar
            locale={locale}
            documents={documents.documents}
            selectedDocumentId={documents.selectedDocumentId}
            loading={documents.loading}
            scaffoldInitialized={documents.response?.scaffoldInitialized ?? false}
            initializing={documents.initializing}
            creating={documents.creating}
            onSelectDocument={documents.selectDocument}
            onInitializeDocsRepo={() => {
              void documents.initializeDocsRepo()
            }}
            onCreateDocument={createDocument}
          />

          <div className="designer-main">
            {state.detail ? (
              <>
                <DesignerToolbar
                  locale={locale}
                  canEdit={canEdit}
                  dirty={state.dirty}
                  operation={state.operation}
                  onSave={() => {
                    void state.save().then(() => documents.refresh())
                  }}
                  onRunAgent={() => {
                    void state.runAgentCompletion('mock')
                  }}
                  onExport={(format) => {
                    void state.exportDocument(format)
                  }}
                  onCheckpoint={() => {
                    void state.createCheckpoint('')
                  }}
                  onOpenHistory={() => history.open()}
                />
                <DesignerDocument
                  locale={locale}
                  workspaceRoot={workspaceRoot}
                  title={state.detail.manifest.title}
                  onTitleChange={onTitleChange}
                  briefMarkdown={briefMarkdown}
                  onBriefChange={onBriefChange}
                  agentBlocks={state.agentBlocks}
                  readOnly={state.loading}
                />
              </>
            ) : state.loading ? (
              <div className="designer-empty">
                <AppIcon name="refresh" className="designer-empty-icon" aria-hidden="true" />
                <p>{t(locale, 'designer.loading')}</p>
              </div>
            ) : (
              <div className="designer-empty">
                <AppIcon name="designer" className="designer-empty-icon" aria-hidden="true" />
                <h2>{t(locale, 'designer.emptyTitle')}</h2>
                <p>{t(locale, 'designer.emptyDetail')}</p>
              </div>
            )}
          </div>

          <DesignerPatchSheet
            locale={locale}
            patchValidation={state.patchValidation}
            operation={state.operation}
            onApply={(acceptedChangeIndices) => {
              void state.applyPatch(acceptedChangeIndices).then(() => documents.refresh())
            }}
            onDismiss={() => state.clearPatchValidation()}
          />

          <DesignerHistorySheet locale={locale} history={history} />
        </div>
      ) : (
        <div className="designer-empty designer-empty--center">
          <AppIcon name="designer" className="designer-empty-icon" aria-hidden="true" />
          <h2>{t(locale, 'designer.workspaceRequired')}</h2>
          <p>{t(locale, 'designer.workspaceDetail')}</p>
        </div>
      )}

      <DesignerStatusbar
        locale={locale}
        dirty={state.dirty}
        operation={state.operation}
        status={state.detail?.manifest.status ?? null}
        schemaVersion={state.detail ? DESIGNER_SCHEMA_VERSION : null}
        diagnosticCount={state.diagnostics.length}
        scaffoldInitialized={documents.response?.scaffoldInitialized ?? false}
        notice={state.notice}
      />
    </div>
  )
}
