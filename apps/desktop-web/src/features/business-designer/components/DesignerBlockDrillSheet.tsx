import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerBlock, DesignerBlockPatch } from '../model/designer-blocks'
import {
  addApiEndpoint,
  addEntityField,
  addFlowState,
  addFlowTransition,
  formatEndpointErrors,
  removeApiEndpoint,
  removeEntityField,
  removeFlowState,
  removeFlowTransition,
  renameEntityModel,
  renameFlowState,
  updateApiEndpoint,
  updateApiEndpointErrors,
  updateEntityField,
  updateFlowState,
  updateFlowStateEntity,
  updateFlowTransition,
  type ApiContractPayload,
  type BusinessFlowPayload,
  type EntityModelPayload,
} from '../model/designer-drill-payload'

interface DesignerBlockDrillSheetProps {
  locale: Locale
  block: DesignerBlock | null
  isOpen: boolean
  onClose: () => void
  onUpdateBlock: (blockId: string, patch: DesignerBlockPatch) => void
  onDeleteBlock: (block: DesignerBlock) => void
  onCreateEntityFromSelection: (name: string) => void
}

/**
 * v1: side-slide drill panel — non-modal, no backdrop, doesn't darken the
 * canvas (§7.4 hard constraint). Renders a kind-specific extremely-minimal
 * structured form so the user can edit fields/states/endpoints without
 * touching JSON.
 */
export const DesignerBlockDrillSheet = memo(function DesignerBlockDrillSheet({
  locale,
  block,
  isOpen,
  onClose,
  onUpdateBlock,
  onDeleteBlock,
  onCreateEntityFromSelection,
}: DesignerBlockDrillSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Esc closes the panel.
  useEffect(() => {
    if (!isOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <div
      ref={panelRef}
      className={`designer-drill-panel${isOpen ? ' is-open' : ''}`}
      role="region"
      aria-hidden={!isOpen}
      aria-labelledby={titleId}
    >
      <header className="designer-drill-header">
        <h2 id={titleId} className="designer-drill-title">
          {block?.title || block?.id || ''}
        </h2>
        {block && block.id !== 'brief' ? (
          <button
            type="button"
            className="designer-icon-button designer-drill-delete-button"
            onClick={() => onDeleteBlock(block)}
            title={t(locale, 'designer.canvas.deleteBlock')}
            aria-label={t(locale, 'designer.canvas.deleteBlock')}
          >
            <AppIcon name="trash" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="designer-icon-button"
          onClick={onClose}
          title={t(locale, 'designer.drill.close')}
          aria-label={t(locale, 'designer.drill.close')}
        >
          <AppIcon name="close" aria-hidden="true" />
        </button>
      </header>
      <div className="designer-drill-content">
        {block ? (
          <BlockForm
            locale={locale}
            block={block}
            onUpdate={onUpdateBlock}
            onCreateEntityFromSelection={onCreateEntityFromSelection}
          />
        ) : null}
      </div>
    </div>
  )
})

interface BaseBlockFormProps {
  locale: Locale
  block: DesignerBlock
  onUpdate: (blockId: string, patch: DesignerBlockPatch) => void
}

interface BlockFormProps extends BaseBlockFormProps {
  onCreateEntityFromSelection: (name: string) => void
}

function BlockForm({ locale, block, onUpdate, onCreateEntityFromSelection }: BlockFormProps) {
  switch (block.kind) {
    case 'entityModel':
      return <EntityModelForm locale={locale} block={block} onUpdate={onUpdate} />
    case 'businessFlow':
      return <BusinessFlowForm locale={locale} block={block} onUpdate={onUpdate} />
    case 'apiContract':
      return <ApiContractForm locale={locale} block={block} onUpdate={onUpdate} />
    case 'text':
      return (
        <TextForm
          locale={locale}
          block={block}
          onUpdate={onUpdate}
          onCreateEntityFromSelection={onCreateEntityFromSelection}
        />
      )
    default:
      return <ReadOnlyJsonView block={block} />
  }
}

function DrillTableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="designer-drill-table-scroll" data-no-drag>
      {children}
    </div>
  )
}

function BlockTitleField({ locale, block, onUpdate }: BaseBlockFormProps) {
  return (
    <section className="designer-drill-form-section">
      <label className="designer-drill-form-label">{t(locale, 'designer.drill.blockTitle')}</label>
      <input
        type="text"
        className="designer-drill-text-input"
        value={block.title}
        data-no-drag
        onChange={(event) => onUpdate(block.id, { title: event.target.value })}
      />
    </section>
  )
}

// ----- entityModel ---------------------------------------------------------

function EntityModelForm({ locale, block, onUpdate }: BaseBlockFormProps) {
  const payload = (block.payload as EntityModelPayload) ?? {}
  const fields = payload.fields ?? []

  function patchPayload(next: EntityModelPayload) {
    onUpdate(block.id, {
      payload: next,
    })
  }

  function updateEntityName(entityName: string) {
    onUpdate(block.id, {
      title: entityName,
      payload: renameEntityModel(payload, entityName),
    })
  }

  return (
    <>
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.drill.entityName')}</label>
        <input
          type="text"
          className="designer-drill-text-input"
          value={payload.entityName ?? ''}
          placeholder={block.title}
          data-no-drag
          onChange={(event) => updateEntityName(event.target.value)}
          onBlur={(event) => updateEntityName(event.target.value.trim())}
        />
      </section>
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.drill.fields')}</label>
        <DrillTableFrame>
          <table className="designer-drill-table">
            <thead>
              <tr>
                <th className="designer-drill-col-name">{t(locale, 'designer.drill.colName')}</th>
                <th className="designer-drill-col-type">{t(locale, 'designer.drill.colType')}</th>
                <th>{t(locale, 'designer.drill.colDescription')}</th>
                <th className="designer-drill-col-check">{t(locale, 'designer.drill.colPK')}</th>
                <th className="designer-drill-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <tr key={index}>
                  <td>
                    <input
                      type="text"
                      value={field.name ?? ''}
                      onChange={(e) =>
                        patchPayload(updateEntityField(payload, index, { name: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={field.type ?? ''}
                      onChange={(e) =>
                        patchPayload(updateEntityField(payload, index, { type: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={field.description ?? ''}
                      onChange={(e) =>
                        patchPayload(
                          updateEntityField(payload, index, { description: e.target.value }),
                        )
                      }
                    />
                  </td>
                  <td className="designer-drill-check-cell">
                    <input
                      type="checkbox"
                      checked={Boolean(field.isPrimaryKey)}
                      onChange={(e) =>
                        patchPayload(
                          updateEntityField(payload, index, { isPrimaryKey: e.target.checked }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="designer-drill-row-actions">
                      <button
                        type="button"
                        className="designer-icon-button"
                        onClick={() => patchPayload(removeEntityField(payload, index))}
                        title={t(locale, 'designer.drill.removeRow')}
                        aria-label={t(locale, 'designer.drill.removeRow')}
                      >
                        <AppIcon name="trash" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DrillTableFrame>
        <button
          type="button"
          className="designer-drill-add-row"
          onClick={() => patchPayload(addEntityField(payload))}
          data-no-drag
        >
          <AppIcon name="plus" aria-hidden="true" />
          {t(locale, 'designer.drill.addRow')}
        </button>
      </section>
    </>
  )
}

// ----- businessFlow --------------------------------------------------------

function BusinessFlowForm({ locale, block, onUpdate }: BaseBlockFormProps) {
  const payload = (block.payload as BusinessFlowPayload) ?? {}
  const states = payload.states ?? []
  const transitions = payload.transitions ?? []

  function patchPayload(next: BusinessFlowPayload) {
    onUpdate(block.id, { payload: next })
  }

  return (
    <>
      <BlockTitleField locale={locale} block={block} onUpdate={onUpdate} />
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.drill.states')}</label>
        <DrillTableFrame>
          <table className="designer-drill-table designer-drill-table--flow">
            <thead>
              <tr>
                <th>{t(locale, 'designer.drill.colName')}</th>
                <th>{t(locale, 'designer.drill.colEntity')}</th>
                <th className="designer-drill-col-check">{t(locale, 'designer.drill.colInitial')}</th>
                <th className="designer-drill-col-check">{t(locale, 'designer.drill.colTerminal')}</th>
                <th className="designer-drill-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {states.map((state, index) => (
                <tr key={index}>
                  <td>
                    <input
                      type="text"
                      value={state.name ?? ''}
                      onChange={(e) =>
                        patchPayload(renameFlowState(payload, index, e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={state.entity ?? state.target ?? ''}
                      onChange={(e) =>
                        patchPayload(updateFlowStateEntity(payload, index, e.target.value))
                      }
                    />
                  </td>
                  <td className="designer-drill-check-cell">
                    <input
                      type="checkbox"
                      checked={Boolean(state.initial)}
                      onChange={(e) =>
                        patchPayload(updateFlowState(payload, index, { initial: e.target.checked }))
                      }
                    />
                  </td>
                  <td className="designer-drill-check-cell">
                    <input
                      type="checkbox"
                      checked={Boolean(state.terminal)}
                      onChange={(e) =>
                        patchPayload(updateFlowState(payload, index, { terminal: e.target.checked }))
                      }
                    />
                  </td>
                  <td>
                    <div className="designer-drill-row-actions">
                      <button
                        type="button"
                        className="designer-icon-button"
                        onClick={() => patchPayload(removeFlowState(payload, index))}
                        title={t(locale, 'designer.drill.removeRow')}
                        aria-label={t(locale, 'designer.drill.removeRow')}
                      >
                        <AppIcon name="trash" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DrillTableFrame>
        <button
          type="button"
          className="designer-drill-add-row"
          onClick={() => patchPayload(addFlowState(payload))}
          data-no-drag
        >
          <AppIcon name="plus" aria-hidden="true" />
          {t(locale, 'designer.drill.addRow')}
        </button>
      </section>
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">
          {t(locale, 'designer.drill.transitions')}
        </label>
        <DrillTableFrame>
          <table className="designer-drill-table">
            <thead>
              <tr>
                <th>{t(locale, 'designer.drill.colFrom')}</th>
                <th>{t(locale, 'designer.drill.colTo')}</th>
                <th className="designer-drill-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((transition, index) => (
                <tr key={index}>
                  <td>
                    <select
                      value={transition.from ?? ''}
                      onChange={(e) =>
                        patchPayload(updateFlowTransition(payload, index, { from: e.target.value }))
                      }
                    >
                      <option value=""></option>
                      {states.map((state, stateIndex) => (
                        <option key={`${stateIndex}:${state.name ?? ''}`} value={state.name ?? ''}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={transition.to ?? ''}
                      onChange={(e) =>
                        patchPayload(updateFlowTransition(payload, index, { to: e.target.value }))
                      }
                    >
                      <option value=""></option>
                      {states.map((state, stateIndex) => (
                        <option key={`${stateIndex}:${state.name ?? ''}`} value={state.name ?? ''}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="designer-drill-row-actions">
                      <button
                        type="button"
                        className="designer-icon-button"
                        onClick={() => patchPayload(removeFlowTransition(payload, index))}
                        title={t(locale, 'designer.drill.removeRow')}
                        aria-label={t(locale, 'designer.drill.removeRow')}
                      >
                        <AppIcon name="trash" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DrillTableFrame>
        <button
          type="button"
          className="designer-drill-add-row"
          onClick={() => patchPayload(addFlowTransition(payload))}
          data-no-drag
        >
          <AppIcon name="plus" aria-hidden="true" />
          {t(locale, 'designer.drill.addRow')}
        </button>
      </section>
    </>
  )
}

// ----- apiContract ---------------------------------------------------------

function ApiContractForm({ locale, block, onUpdate }: BaseBlockFormProps) {
  const payload = (block.payload as ApiContractPayload) ?? {}
  const endpoints = payload.endpoints ?? []

  function patchPayload(next: ApiContractPayload) {
    onUpdate(block.id, { payload: next })
  }

  return (
    <>
      <BlockTitleField locale={locale} block={block} onUpdate={onUpdate} />
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.drill.endpoints')}</label>
        <DrillTableFrame>
          <table className="designer-drill-table designer-drill-table--api">
            <thead>
              <tr>
                <th className="designer-drill-col-method">{t(locale, 'designer.drill.colMethod')}</th>
                <th className="designer-drill-col-path">{t(locale, 'designer.drill.colPath')}</th>
                <th>{t(locale, 'designer.drill.colRequest')}</th>
                <th>{t(locale, 'designer.drill.colResponse')}</th>
                <th>{t(locale, 'designer.drill.colErrors')}</th>
                <th className="designer-drill-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint, index) => (
                <tr key={index}>
                  <td>
                    <select
                      value={(endpoint.method ?? '').toUpperCase()}
                      onChange={(e) =>
                        patchPayload(updateApiEndpoint(payload, index, { method: e.target.value }))
                      }
                    >
                      <option value=""></option>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={endpoint.path ?? ''}
                      onChange={(e) =>
                        patchPayload(updateApiEndpoint(payload, index, { path: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={endpoint.request ?? ''}
                      onChange={(e) =>
                        patchPayload(updateApiEndpoint(payload, index, { request: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={endpoint.response ?? ''}
                      onChange={(e) =>
                        patchPayload(updateApiEndpoint(payload, index, { response: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={formatEndpointErrors(endpoint)}
                      onChange={(e) =>
                        patchPayload(updateApiEndpointErrors(payload, index, e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <div className="designer-drill-row-actions">
                      <button
                        type="button"
                        className="designer-icon-button"
                        onClick={() => patchPayload(removeApiEndpoint(payload, index))}
                        title={t(locale, 'designer.drill.removeRow')}
                        aria-label={t(locale, 'designer.drill.removeRow')}
                      >
                        <AppIcon name="trash" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DrillTableFrame>
        <button
          type="button"
          className="designer-drill-add-row"
          onClick={() => patchPayload(addApiEndpoint(payload))}
          data-no-drag
        >
          <AppIcon name="plus" aria-hidden="true" />
          {t(locale, 'designer.drill.addRow')}
        </button>
      </section>
    </>
  )
}

// ----- text (brief root) ---------------------------------------------------

function TextForm({ locale, block, onUpdate, onCreateEntityFromSelection }: BlockFormProps) {
  const payload = (block.payload as { markdown?: string }) ?? {}
  const [selectedText, setSelectedText] = useState('')
  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onUpdate(block.id, { payload: { ...payload, markdown: event.target.value } })
  }
  function captureSelection(target: HTMLTextAreaElement) {
    const selection = target.value
      .slice(target.selectionStart, target.selectionEnd)
      .trim()
      .replace(/\s+/g, ' ')
    setSelectedText(selection.length > 0 ? selection.slice(0, 80) : '')
  }
  return (
    <section className="designer-drill-form-section">
      <label className="designer-drill-form-label">{t(locale, 'designer.brief')}</label>
      <textarea
        className="designer-brief-textarea designer-brief-textarea--drill"
        value={payload.markdown ?? ''}
        placeholder={t(locale, 'designer.drill.briefHint')}
        onChange={onChange}
        onSelect={(event) => captureSelection(event.currentTarget)}
        onKeyUp={(event) => captureSelection(event.currentTarget)}
        onMouseUp={(event) => captureSelection(event.currentTarget)}
        rows={12}
        data-no-drag
      />
      <div className="designer-brief-selection-actions">
        <button
          type="button"
          className="designer-brief-selection-action"
          disabled={!selectedText}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!selectedText) return
            onCreateEntityFromSelection(selectedText)
            setSelectedText('')
          }}
        >
          <AppIcon name="external" aria-hidden="true" />
          {selectedText
            ? t(locale, 'designer.brief.modelSelection', { text: selectedText })
            : t(locale, 'designer.brief.selectToModel')}
        </button>
      </div>
    </section>
  )
}

function ReadOnlyJsonView({ block }: { block: DesignerBlock }) {
  const json = JSON.stringify(block.payload, null, 2)
  return (
    <pre
      className="designer-drill-json"
      data-no-drag
    >
      {json}
    </pre>
  )
}
