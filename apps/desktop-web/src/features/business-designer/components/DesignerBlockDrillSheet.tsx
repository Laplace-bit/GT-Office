import { memo, useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerBlock, DesignerBlockPatch } from '../model/designer-blocks'

interface DesignerBlockDrillSheetProps {
  locale: Locale
  block: DesignerBlock | null
  isOpen: boolean
  onClose: () => void
  onUpdateBlock: (blockId: string, patch: DesignerBlockPatch) => void
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

// ----- entityModel ---------------------------------------------------------

interface EntityField {
  name?: string
  type?: string
  description?: string
  isPrimaryKey?: boolean
}

function EntityModelForm({ locale, block, onUpdate }: BaseBlockFormProps) {
  const payload = (block.payload as { entityName?: string; fields?: EntityField[] }) ?? {}
  const fields = payload.fields ?? []

  function patchPayload(next: { entityName?: string; fields?: EntityField[] }) {
    onUpdate(block.id, {
      payload: { ...payload, ...next },
    })
  }

  function updateField(index: number, patch: Partial<EntityField>) {
    const nextFields = fields.map((field, i) => (i === index ? { ...field, ...patch } : field))
    patchPayload({ fields: nextFields })
  }
  function removeField(index: number) {
    patchPayload({ fields: fields.filter((_, i) => i !== index) })
  }
  function addField() {
    patchPayload({ fields: [...fields, { name: '', type: 'string' }] })
  }

  return (
    <>
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.inspector.kind')}</label>
        <input
          type="text"
          className="designer-drill-text-input"
          value={payload.entityName ?? ''}
          placeholder={block.title}
          data-no-drag
          onChange={(event) => patchPayload({ entityName: event.target.value })}
          onBlur={(event) => patchPayload({ entityName: event.target.value })}
        />
      </section>
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.drill.fields')}</label>
        <table className="designer-drill-table" data-no-drag>
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
                    onChange={(e) => updateField(index, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={field.type ?? ''}
                    onChange={(e) => updateField(index, { type: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={field.description ?? ''}
                    onChange={(e) => updateField(index, { description: e.target.value })}
                  />
                </td>
                <td className="designer-drill-check-cell">
                  <input
                    type="checkbox"
                    checked={Boolean(field.isPrimaryKey)}
                    onChange={(e) => updateField(index, { isPrimaryKey: e.target.checked })}
                  />
                </td>
                <td>
                  <div className="designer-drill-row-actions">
                    <button
                      type="button"
                      className="designer-icon-button"
                      onClick={() => removeField(index)}
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
        <button type="button" className="designer-drill-add-row" onClick={addField} data-no-drag>
          <AppIcon name="plus" aria-hidden="true" />
          {t(locale, 'designer.drill.addRow')}
        </button>
      </section>
    </>
  )
}

// ----- businessFlow --------------------------------------------------------

interface FlowState {
  name?: string
  initial?: boolean
  terminal?: boolean
}
interface FlowTransition {
  from?: string
  to?: string
}

function BusinessFlowForm({ locale, block, onUpdate }: BaseBlockFormProps) {
  const payload =
    (block.payload as { states?: FlowState[]; transitions?: FlowTransition[] }) ?? {}
  const states = payload.states ?? []
  const transitions = payload.transitions ?? []

  function patchPayload(next: { states?: FlowState[]; transitions?: FlowTransition[] }) {
    onUpdate(block.id, { payload: { ...payload, ...next } })
  }

  return (
    <>
      <section className="designer-drill-form-section">
        <label className="designer-drill-form-label">{t(locale, 'designer.drill.states')}</label>
        <table className="designer-drill-table" data-no-drag>
          <thead>
            <tr>
              <th>{t(locale, 'designer.drill.colName')}</th>
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
                      patchPayload({
                        states: states.map((s, i) => (i === index ? { ...s, name: e.target.value } : s)),
                      })
                    }
                  />
                </td>
                <td className="designer-drill-check-cell">
                  <input
                    type="checkbox"
                    checked={Boolean(state.initial)}
                    onChange={(e) =>
                      patchPayload({
                        states: states.map((s, i) =>
                          i === index ? { ...s, initial: e.target.checked } : s,
                        ),
                      })
                    }
                  />
                </td>
                <td className="designer-drill-check-cell">
                  <input
                    type="checkbox"
                    checked={Boolean(state.terminal)}
                    onChange={(e) =>
                      patchPayload({
                        states: states.map((s, i) =>
                          i === index ? { ...s, terminal: e.target.checked } : s,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <div className="designer-drill-row-actions">
                    <button
                      type="button"
                      className="designer-icon-button"
                      onClick={() => patchPayload({ states: states.filter((_, i) => i !== index) })}
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
        <button
          type="button"
          className="designer-drill-add-row"
          onClick={() => patchPayload({ states: [...states, { name: '' }] })}
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
        <table className="designer-drill-table" data-no-drag>
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
                      patchPayload({
                        transitions: transitions.map((t2, i) =>
                          i === index ? { ...t2, from: e.target.value } : t2,
                        ),
                      })
                    }
                  >
                    <option value=""></option>
                    {states.map((state) => (
                      <option key={state.name} value={state.name}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={transition.to ?? ''}
                    onChange={(e) =>
                      patchPayload({
                        transitions: transitions.map((t2, i) =>
                          i === index ? { ...t2, to: e.target.value } : t2,
                        ),
                      })
                    }
                  >
                    <option value=""></option>
                    {states.map((state) => (
                      <option key={state.name} value={state.name}>
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
                      onClick={() =>
                        patchPayload({
                          transitions: transitions.filter((_, i) => i !== index),
                        })
                      }
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
        <button
          type="button"
          className="designer-drill-add-row"
          onClick={() =>
            patchPayload({ transitions: [...transitions, { from: '', to: '' }] })
          }
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

interface ApiEndpoint {
  method?: string
  path?: string
  response?: string
  description?: string
}

function ApiContractForm({ locale, block, onUpdate }: BaseBlockFormProps) {
  const payload = (block.payload as { endpoints?: ApiEndpoint[] }) ?? {}
  const endpoints = payload.endpoints ?? []

  function patchEndpoints(next: ApiEndpoint[]) {
    onUpdate(block.id, { payload: { ...payload, endpoints: next } })
  }

  return (
    <section className="designer-drill-form-section">
      <label className="designer-drill-form-label">{t(locale, 'designer.drill.endpoints')}</label>
      <table className="designer-drill-table" data-no-drag>
        <thead>
          <tr>
            <th className="designer-drill-col-method">{t(locale, 'designer.drill.colMethod')}</th>
            <th className="designer-drill-col-path">{t(locale, 'designer.drill.colPath')}</th>
            <th>{t(locale, 'designer.drill.colResponse')}</th>
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
                    patchEndpoints(
                      endpoints.map((ep, i) =>
                        i === index ? { ...ep, method: e.target.value } : ep,
                      ),
                    )
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
                    patchEndpoints(
                      endpoints.map((ep, i) =>
                        i === index ? { ...ep, path: e.target.value } : ep,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <input
                  type="text"
                  value={endpoint.response ?? ''}
                  onChange={(e) =>
                    patchEndpoints(
                      endpoints.map((ep, i) =>
                        i === index ? { ...ep, response: e.target.value } : ep,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <div className="designer-drill-row-actions">
                  <button
                    type="button"
                    className="designer-icon-button"
                    onClick={() =>
                      patchEndpoints(endpoints.filter((_, i) => i !== index))
                    }
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
      <button
        type="button"
        className="designer-drill-add-row"
        onClick={() =>
          patchEndpoints([
            ...endpoints,
            { method: 'GET', path: '', response: '', description: '' },
          ])
        }
        data-no-drag
      >
        <AppIcon name="plus" aria-hidden="true" />
        {t(locale, 'designer.drill.addRow')}
      </button>
    </section>
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
