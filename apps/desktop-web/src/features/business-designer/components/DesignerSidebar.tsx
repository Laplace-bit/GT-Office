import { type FormEvent, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type {
  DesignerCreateDocumentParams,
  DesignerDocumentSummary,
} from '../model/designer-document'

interface DesignerSidebarProps {
  locale: Locale
  documents: DesignerDocumentSummary[]
  selectedDocumentId: string | null
  loading: boolean
  scaffoldInitialized: boolean
  initializing: boolean
  creating: boolean
  onCollapse: () => void
  onSelectDocument: (documentId: string) => void
  onInitializeDocsRepo: () => void
  onCreateDocument: (params: DesignerCreateDocumentParams) => void
}

function slugFromTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return slug || 'design'
}

export function DesignerSidebar({
  locale,
  documents,
  selectedDocumentId,
  loading,
  scaffoldInitialized,
  initializing,
  creating,
  onCollapse,
  onSelectDocument,
  onInitializeDocsRepo,
  onCreateDocument,
}: DesignerSidebarProps) {
  const [title, setTitle] = useState('')
  const [creatingOpen, setCreatingOpen] = useState(false)

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      return
    }
    onCreateDocument({
      documentId: slugFromTitle(trimmedTitle),
      title: trimmedTitle,
      module: null,
    })
    setTitle('')
    setCreatingOpen(false)
  }

  return (
    <aside
      className="designer-sidebar-panel"
      aria-label={t(locale, 'designer.library')}
    >
      <header className="designer-sidebar-header">
        <span className="designer-sidebar-heading">
          <AppIcon name="folder-open" className="designer-sidebar-heading-icon" aria-hidden="true" />
          <span className="designer-sidebar-title">{t(locale, 'designer.library')}</span>
        </span>
        <div className="designer-sidebar-actions">
          <button
            type="button"
            className="designer-icon-button designer-sidebar-collapse-button"
            onClick={onCollapse}
            aria-label={t(locale, 'designer.library.collapse')}
            title={t(locale, 'designer.library.collapse')}
          >
            <AppIcon name="panel-right-close" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="designer-icon-button"
            onClick={() => setCreatingOpen((open) => !open)}
            aria-label={t(locale, 'designer.newDocument')}
            title={t(locale, 'designer.newDocument')}
            aria-expanded={creatingOpen}
          >
            <AppIcon name="file-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="designer-icon-button"
            onClick={onInitializeDocsRepo}
            disabled={initializing}
            aria-label={t(locale, 'designer.initLibrary')}
            title={t(locale, 'designer.initLibrary')}
          >
            <AppIcon name="folder-plus" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="designer-sidebar-content">
        {creatingOpen ? (
          <form className="designer-create-row" onSubmit={submitCreate}>
            <input
              type="text"
              className="designer-create-input"
              value={title}
              autoFocus
              placeholder={t(locale, 'designer.createPlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="submit"
              className="designer-tool-button designer-create-confirm"
              disabled={creating || !title.trim()}
            >
              <AppIcon name="plus" aria-hidden="true" />
              {creating ? t(locale, 'designer.creating') : t(locale, 'designer.create')}
            </button>
          </form>
        ) : null}

        {loading ? (
          <div className="designer-sidebar-empty">{t(locale, 'designer.loading')}</div>
        ) : documents.length === 0 ? (
          <div className="designer-sidebar-empty">
            {scaffoldInitialized
              ? t(locale, 'designer.emptyLibrary')
              : t(locale, 'designer.notInitialized')}
          </div>
        ) : (
          <ul className="designer-document-list" role="list">
            {documents.map((document) => {
              const selected = document.documentId === selectedDocumentId
              return (
                <li key={document.documentId} className="designer-document-item">
                  <button
                    type="button"
                    className={`designer-document-row ${selected ? 'is-selected' : ''}`}
                    onClick={() => onSelectDocument(document.documentId)}
                    aria-pressed={selected}
                  >
                    <span className="designer-document-row-main">
                      <span className="designer-document-title">{document.title}</span>
                      <span className="designer-document-meta">
                        {document.module ?? document.documentId}
                      </span>
                    </span>
                    <span className={`designer-document-status is-${document.status}`}>
                      {document.status}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
