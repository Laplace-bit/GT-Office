import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { useDesignerDocuments } from './controllers/useDesignerDocuments'
import {
  classifyDesignerError,
  useDesignerDocumentState,
} from './controllers/useDesignerDocumentState'
import { useDesignerFreeformCompletion } from './controllers/useDesignerFreeformCompletion'
import { useDesignerHistory } from './controllers/useDesignerHistory'
import { DesignerSidebar } from './components/DesignerSidebar'
import { DesignerToolbar } from './components/DesignerToolbar'
import {
  DesignerGraphCanvas,
  type DesignerCanvasCreateKind,
} from './components/DesignerGraphCanvas'
import { DesignerInspector } from './components/DesignerInspector'
import { DesignerBlockDrillSheet } from './components/DesignerBlockDrillSheet'
import { DesignerPatchSheet } from './components/DesignerPatchSheet'
import { DesignerHistorySheet } from './components/DesignerHistorySheet'
import { DesignerStatusbar } from './components/DesignerStatusbar'
import { confirmDesignerDestructiveAction } from './controllers/designerDesktopApi'
import { DESIGNER_SCHEMA_VERSION } from './model/designer-document'
import type { DesignerBlock } from './model/designer-blocks'
import type {
  DesignerFreeformCompletionProvider,
  DesignerFreeformCompletionRun,
  DesignerFreeformCompletionScenario,
} from './model/designer-freeform-completion'
import type { DesignerLayoutPosition } from './model/designer-document'
import type { DesignerGap } from './model/designer-validation'
import type { DesignerCreateKind } from './model/designer-toolbar-actions'
import {
  addDesignerBlockToDetail,
  BRIEF_BLOCK_ID,
} from './model/designer-document-operations'

interface BusinessDesignerPaneProps {
  locale: Locale
  workspaceId: string | null
  workspaceRoot: string | null
  active: boolean
  libraryPanelVisible: boolean
  onLibraryPanelVisibleChange: (visible: boolean) => void
}

const LIBRARY_PANEL_WIDTH_MIN = 220
const LIBRARY_PANEL_WIDTH_MAX = 420
const LIBRARY_PANEL_WIDTH_DEFAULT = 272
const FREEFORM_PROVIDER_STORAGE_KEY = 'gtoffice.businessDesigner.freeformProvider'

interface PendingFreeformCompletion {
  scenario: DesignerFreeformCompletionScenario
  hostBlockId?: string | null
  userPrompt?: string | null
}

function clampLibraryPanelWidth(width: number): number {
  return Math.min(LIBRARY_PANEL_WIDTH_MAX, Math.max(LIBRARY_PANEL_WIDTH_MIN, Math.round(width)))
}

export function BusinessDesignerPane({
  locale,
  workspaceId,
  workspaceRoot: _workspaceRoot,
  active,
  libraryPanelVisible,
  onLibraryPanelVisibleChange,
}: BusinessDesignerPaneProps) {
  const documents = useDesignerDocuments({ workspaceId, active })
  const [libraryPanelWidth, setLibraryPanelWidth] = useState(LIBRARY_PANEL_WIDTH_DEFAULT)
  const libraryPanelWidthRef = useRef(libraryPanelWidth)
  const [libraryPanelResizing, setLibraryPanelResizing] = useState(false)
  const state = useDesignerDocumentState({
    workspaceId,
    selectedDocumentId: documents.selectedDocumentId,
    active,
  })

  useEffect(() => {
    libraryPanelWidthRef.current = libraryPanelWidth
  }, [libraryPanelWidth])
  const history = useDesignerHistory({
    workspaceId,
    documentId: state.detail?.manifest.documentId ?? null,
    active,
  })
  const freeformCompletion = useDesignerFreeformCompletion({
    workspaceId,
    documentId: state.detail?.manifest.documentId ?? null,
  })
  const [freeformProvider, setFreeformProviderState] = useState<DesignerFreeformCompletionProvider>(
    () => readStoredFreeformProvider() ?? 'codex',
  )
  const [freeformProviderConfigured, setFreeformProviderConfigured] = useState(
    () => readStoredFreeformProvider() !== null,
  )
  const [pendingFreeformCompletion, setPendingFreeformCompletion] =
    useState<PendingFreeformCompletion | null>(null)

  // Font fallback prewarm — first time the canvas mounts, Chinese/CJK fallbacks
  // can stutter (references/03-webview-survival.md § A.9). Render a hidden span
  // once.
  useEffect(() => {
    if (!active) return
    const span = document.createElement('span')
    span.setAttribute('aria-hidden', 'true')
    span.style.cssText =
      'position:absolute;left:-9999px;top:0;opacity:0;pointer-events:none'
    span.textContent = '订单 实体 流程 契约 Order Customer 状态 → ⚠'
    document.body.appendChild(span)
    void span.getBoundingClientRect()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        span.remove()
      })
    })
  }, [active])

  const createDocument = useCallback(
    (params: { documentId: string; title: string; module?: string | null }) => {
      void documents
        .createDocument({
          documentId: params.documentId,
          title: params.title,
          module: params.module ?? null,
        })
        .then((detail) => {
          if (detail) {
            state.replaceDetail(detail)
          }
        })
    },
    [documents, state],
  )

  const workspaceReady = Boolean(workspaceId)
  const canEdit = Boolean(state.detail)
  const workbenchStyle = useMemo(
    () =>
      ({
        '--designer-library-panel-width': `${libraryPanelWidth}px`,
      }) as CSSProperties,
    [libraryPanelWidth],
  )

  const saveDesignerDocument = useCallback(() => {
    if (!state.detail || state.operation === 'save') {
      return
    }
    void state.save().then(() => documents.refresh())
  }, [documents, state])

  useEffect(() => {
    if (!active || !state.detail) {
      return
    }
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
        return
      }
      event.preventDefault()
      saveDesignerDocument()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, state.detail, saveDesignerDocument])

  const blocks = state.detail?.design.blocks ?? []
  const selectedBlock: DesignerBlock | null = useMemo(
    () => blocks.find((b) => b.id === state.selectedBlockId) ?? null,
    [blocks, state.selectedBlockId],
  )
  const drillBlock: DesignerBlock | null = useMemo(
    () => blocks.find((b) => b.id === state.drillBlockId) ?? null,
    [blocks, state.drillBlockId],
  )

  const onMoveBlock = useCallback(
    (blockId: string, position: DesignerLayoutPosition) => {
      state.setBlockPosition(blockId, position)
    },
    [state],
  )

  const onCreateBlock = useCallback(
    (
      kind: DesignerCreateKind,
      position?: DesignerLayoutPosition,
      overrides?: { title?: string; payload?: Record<string, unknown> },
    ) => {
      if (!state.detail) return
      const result = addDesignerBlockToDetail(state.detail, kind, {
        position,
        title: overrides?.title,
        payload: overrides?.payload,
      })
      state.replaceDetail(result.detail, true)
      state.selectBlock(result.block.id)
      state.openDrill(result.block.id)
    },
    [state],
  )

  const onCreateEntityFromSelection = useCallback(
    (name: string) => {
      const title = name.trim().replace(/\s+/g, ' ')
      if (!title || !state.detail) {
        return
      }
      const briefPosition = state.detail.manifest.layout?.[BRIEF_BLOCK_ID]
      const position = briefPosition
        ? { x: briefPosition.x + 260, y: briefPosition.y + 40 }
        : { x: 380, y: 120 }
      onCreateBlock('entityModel', position, {
        title,
        payload: { entityName: title, fields: [] },
      })
    },
    [onCreateBlock, state.detail],
  )

  const onCreateEntityFromGap = useCallback(
    (gap: DesignerGap) => {
      const title = gap.locator?.ref?.trim().replace(/\s+/g, ' ')
      if (!title || !state.detail) {
        return
      }
      const hostPosition = state.detail.manifest.layout?.[gap.blockId]
      const position = hostPosition
        ? { x: hostPosition.x + 260, y: hostPosition.y + 20 }
        : { x: 420, y: 180 }
      onCreateBlock('entityModel', position, {
        title,
        payload: { entityName: title, fields: [] },
      })
    },
    [onCreateBlock, state.detail],
  )

  const onFixGap = useCallback(
    (blockId: string, gapCode: string) => {
      void state.previewAgentTask({
        provider: 'mock',
        hostBlockId: blockId,
        gapCodes: [gapCode],
        scope: 'single',
      })
    },
    [state],
  )

  const onFixBlock = useCallback(
    (blockId: string) => {
      void state.previewAgentTask({
        provider: 'mock',
        hostBlockId: blockId,
        gapCodes: [],
        scope: 'block',
      })
    },
    [state],
  )

  const onConfirmAgentPreview = useCallback((provider: string, targetAgentIds: string[]) => {
    const preview = state.agentPreview
    if (!preview || preview.status !== 'ready') {
      return
    }
    void state.runAgentCompletion({
      provider,
      targetAgentIds,
      hostBlockId: preview.hostBlockId,
      gapCodes: preview.gapCodes,
      scope: preview.scope === 'single' ? 'single' : 'block',
    })
  }, [state])

  const setFreeformProvider = useCallback((provider: DesignerFreeformCompletionProvider) => {
    setFreeformProviderState(provider)
    try {
      window.localStorage.setItem(FREEFORM_PROVIDER_STORAGE_KEY, provider)
    } catch {
      // Local storage can be unavailable in restricted WebViews; keep the in-memory choice.
    }
    setFreeformProviderConfigured(true)
  }, [])

  const dispatchFreeformCompletion = useCallback(
    (params: PendingFreeformCompletion, provider: DesignerFreeformCompletionProvider) => {
      void (async () => {
        if (state.dirty) {
          const saved = await state.save()
          if (!saved) {
            return
          }
          void documents.refresh()
        }
        const run = await freeformCompletion.startCompletion({
          ...params,
          provider,
        })
        if (run) {
          void history.refresh()
        }
      })()
    },
    [documents, freeformCompletion, history, state],
  )

  const onStartFreeformCompletion = useCallback(
    (params: PendingFreeformCompletion) => {
      if (!freeformProviderConfigured) {
        setPendingFreeformCompletion(params)
        return
      }
      dispatchFreeformCompletion(params, freeformProvider)
    },
    [dispatchFreeformCompletion, freeformProvider, freeformProviderConfigured],
  )

  const configureFreeformProvider = useCallback(
    (provider: DesignerFreeformCompletionProvider) => {
      setFreeformProvider(provider)
      const pending = pendingFreeformCompletion
      setPendingFreeformCompletion(null)
      if (pending) {
        dispatchFreeformCompletion(pending, provider)
      }
    },
    [dispatchFreeformCompletion, pendingFreeformCompletion, setFreeformProvider],
  )

  const confirmFreeformProvider = useCallback(() => {
    configureFreeformProvider(freeformProvider)
  }, [configureFreeformProvider, freeformProvider])

  const onViewFreeformChanges = useCallback(
    (checkpoint: string) => {
      history.openDiffFromCheckpoint(checkpoint)
    },
    [history],
  )

  const onExpandCanvas = useCallback((userPrompt?: string | null) => {
    onStartFreeformCompletion({
      scenario: 'expand_canvas',
      hostBlockId: state.selectedBlockId,
      userPrompt: userPrompt?.trim() || null,
    })
  }, [onStartFreeformCompletion, state.selectedBlockId])

  const onRevertFreeformRun = useCallback(
    (run: DesignerFreeformCompletionRun) => {
      void confirmDesignerDestructiveAction(
        t(locale, 'designer.freeform.revert'),
        t(locale, 'designer.freeform.revertConfirm', {
          checkpoint: run.checkpointBefore,
        }),
      )
        .then((confirmed) => {
          if (!confirmed) {
            return
          }
          void state.revertToCheckpoint(run.checkpointBefore).then(() => {
            void documents.refresh()
            void freeformCompletion.refreshRuns()
            void history.refresh()
          })
        })
        .catch((error: unknown) => {
          console.warn('Business Designer freeform revert confirmation failed', error)
        })
    },
    [documents, freeformCompletion, history, locale, state],
  )

  const onDeleteBlock = useCallback(
    (block: DesignerBlock) => {
      if (block.id === BRIEF_BLOCK_ID) {
        return
      }
      void confirmDesignerDestructiveAction(
        t(locale, 'designer.inspector.deleteBlock'),
        t(locale, 'designer.inspector.deleteConfirm', {
          title: block.title || block.id,
        }),
      )
        .then((confirmed) => {
          if (!confirmed) {
            return
          }
          state.deleteBlock(block.id)
        })
        .catch((error: unknown) => {
          console.warn('Business Designer delete confirmation failed', error)
        })
    },
    [locale, state],
  )

  const onApplyPatch = useCallback(
    (acceptedChangeIndices: number[]) => {
      void state.applyPatch(acceptedChangeIndices).then(() => documents.refresh())
    },
    [state, documents],
  )

  const onLibraryPanelResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = libraryPanelWidthRef.current
      setLibraryPanelResizing(true)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setLibraryPanelWidth(clampLibraryPanelWidth(startWidth + moveEvent.clientX - startX))
      }
      const handlePointerUp = () => {
        setLibraryPanelResizing(false)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [],
  )

  const onLibraryPanelResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setLibraryPanelWidth((width) => clampLibraryPanelWidth(width - step))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setLibraryPanelWidth((width) => clampLibraryPanelWidth(width + step))
    }
  }, [])

  const error = documents.error ?? state.error
  const friendlyKey = error ? classifyDesignerError(error) : null

  return (
    <div className="business-designer-pane">
      {error ? (
        <div className="designer-error-banner" role="alert">
          <AppIcon
            name="alert-circle"
            className="designer-error-banner-icon"
            aria-hidden="true"
          />
          <div className="designer-error-banner-body">
            <div className="designer-error-banner-title">
              {t(locale, 'designer.error.title')}
            </div>
            <div className="designer-error-banner-message">
              {friendlyKey
                ? t(locale, friendlyKey as 'designer.error.staleRevision')
                : error}
            </div>
          </div>
        </div>
      ) : null}

      {workspaceReady ? (
        <div
          className={`designer-workbench ${libraryPanelVisible ? '' : 'is-library-collapsed'}`}
          style={workbenchStyle}
        >
          {libraryPanelVisible ? (
            <>
              <DesignerSidebar
                locale={locale}
                documents={documents.documents}
                selectedDocumentId={documents.selectedDocumentId}
                loading={documents.loading}
                scaffoldInitialized={documents.response?.scaffoldInitialized ?? false}
                initializing={documents.initializing}
                creating={documents.creating}
                onCollapse={() => onLibraryPanelVisibleChange(false)}
                onSelectDocument={documents.selectDocument}
                onInitializeDocsRepo={() => {
                  void documents.initializeDocsRepo()
                }}
                onCreateDocument={createDocument}
              />
              <div
                className={`designer-library-resizer ${libraryPanelResizing ? 'active' : ''}`}
                role="separator"
                aria-label={t(locale, 'designer.library.resize')}
                aria-orientation="vertical"
                aria-valuemin={LIBRARY_PANEL_WIDTH_MIN}
                aria-valuemax={LIBRARY_PANEL_WIDTH_MAX}
                aria-valuenow={libraryPanelWidth}
                tabIndex={0}
                onPointerDown={onLibraryPanelResizePointerDown}
                onKeyDown={onLibraryPanelResizeKeyDown}
              />
            </>
          ) : null}

          <div className="designer-main">
            {state.detail ? (
              <>
                <DesignerToolbar
                  locale={locale}
                  canEdit={canEdit}
                  dirty={state.dirty}
                  operation={state.operation}
                  agentRunning={freeformCompletion.running}
                  onSave={saveDesignerDocument}
                  onExport={(format) => {
                    void state.exportDocument(format)
                  }}
                  onCheckpoint={() => {
                    void state.createCheckpoint('').then(() => history.refresh())
                  }}
                  onOpenHistory={() => history.open()}
                  onCreateBlock={onCreateBlock}
                  onExpandCanvas={onExpandCanvas}
                />

                <div
                  className={`designer-workbench-v1 ${
                    state.drillBlockId ? 'has-open-drill' : ''
                  }`}
                >
                  <div className="designer-canvas-stack">
                    <DesignerGraphCanvas
                      locale={locale}
                      blocks={blocks}
                      gaps={state.gaps}
                      edges={state.derivedEdges}
                      layout={state.detail.manifest.layout}
                      selectedBlockId={state.selectedBlockId}
                      drillBlockId={state.drillBlockId}
                      onSelectBlock={state.selectBlock}
                      onOpenDrill={state.openDrill}
                      onCloseDrill={() => state.openDrill(null)}
                      onMoveBlock={onMoveBlock}
                      onDeleteBlock={onDeleteBlock}
                      onCreateBlock={(kind: DesignerCanvasCreateKind, position) =>
                        onCreateBlock(kind, position)
                      }
                    />
                    <DesignerBlockDrillSheet
                      locale={locale}
                      block={drillBlock ?? selectedBlock}
                      isOpen={Boolean(state.drillBlockId)}
                      onClose={() => state.openDrill(null)}
                      onUpdateBlock={(blockId, patch) => state.updateBlock(blockId, patch)}
                      onDeleteBlock={onDeleteBlock}
                      onCreateEntityFromSelection={onCreateEntityFromSelection}
                    />
                  </div>
                  <DesignerInspector
                    locale={locale}
                    block={selectedBlock}
                    gaps={state.gaps}
                    edges={state.derivedEdges}
                    agentPreview={state.agentPreview}
                    agents={state.agents}
                    agentDispatch={state.agentDispatch}
                    agentBusy={state.operation === 'agent' || state.operation === 'apply'}
                    freeformRuns={freeformCompletion.runs}
                    freeformRunLogs={freeformCompletion.runLogs}
                    freeformLogLoadingRunId={freeformCompletion.logLoadingRunId}
                    freeformBusy={freeformCompletion.starting || state.operation === 'save'}
                    freeformError={freeformCompletion.error}
                    freeformProvider={freeformProvider}
                    freeformProviderConfigured={freeformProviderConfigured}
                    freeformProviderPending={Boolean(pendingFreeformCompletion)}
                    onOpenDrill={state.openDrill}
                    onFixGap={onFixGap}
                    onFixBlock={onFixBlock}
                    onCreateEntityFromGap={onCreateEntityFromGap}
                    onConfirmAgentPreview={onConfirmAgentPreview}
                    onReloadDocument={state.loadDocument}
                    onCancelAgentPreview={state.clearAgentPreview}
                    onFreeformProviderChange={configureFreeformProvider}
                    onConfirmFreeformProvider={confirmFreeformProvider}
                    onStartFreeformCompletion={onStartFreeformCompletion}
                    onRefreshFreeformRuns={freeformCompletion.refreshRuns}
                    onReadFreeformRunLog={freeformCompletion.readRunLog}
                    onStopFreeformRun={freeformCompletion.stopRun}
                    onViewFreeformChanges={onViewFreeformChanges}
                    onRevertFreeformRun={onRevertFreeformRun}
                  />
                </div>
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
            gapResolution={state.gapResolution}
            onApply={onApplyPatch}
            onCheckpoint={() => {
              void state.createCheckpoint('').then(() => history.refresh())
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
        gapCount={state.gaps.length}
        scaffoldInitialized={documents.response?.scaffoldInitialized ?? false}
        notice={state.notice}
        onSaveExternalChange={() => {
          void state.save().then(() => {
            void documents.refresh()
          })
        }}
        onDiscardExternalChange={() => {
          void state.discardLocalAndReload().then(() => {
            void documents.refresh()
          })
        }}
      />
    </div>
  )
}

export { BRIEF_BLOCK_ID }

function readStoredFreeformProvider(): DesignerFreeformCompletionProvider | null {
  try {
    const stored = window.localStorage.getItem(FREEFORM_PROVIDER_STORAGE_KEY)
    if (stored === 'claude' || stored === 'codex') {
      return stored
    }
    return null
  } catch {
    return null
  }
}
