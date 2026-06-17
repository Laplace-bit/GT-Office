import { useEffect, useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerPatchValidationResult } from '../model/designer-patch'
import type { DesignerOperation } from '../controllers/useDesignerDocumentState'

interface DesignerPatchSheetProps {
  locale: Locale
  patchValidation: DesignerPatchValidationResult | null
  operation: DesignerOperation | null
  onApply: (acceptedChangeIndices: number[]) => void
  onDismiss: () => void
}

function opLabel(locale: Locale, op: string): string {
  switch (op) {
    case 'addBlock':
      return t(locale, 'designer.patch.add')
    case 'updateBlock':
      return t(locale, 'designer.patch.update')
    case 'deleteBlock':
      return t(locale, 'designer.patch.delete')
    default:
      return op
  }
}

export function DesignerPatchSheet({
  locale,
  patchValidation,
  operation,
  onApply,
  onDismiss,
}: DesignerPatchSheetProps) {
  const changes = patchValidation?.changes ?? []
  const defaultAccepted = useMemo(
    () =>
      changes
        .map((change, index) => (change.destructive ? null : index))
        .filter((index): index is number => index !== null),
    [changes],
  )
  const [accepted, setAccepted] = useState<number[]>(defaultAccepted)

  useEffect(() => {
    setAccepted(defaultAccepted)
  }, [defaultAccepted, patchValidation])

  if (!patchValidation) {
    return null
  }

  const toggle = (index: number) => {
    setAccepted((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b),
    )
  }
  const destructiveSelected = changes.some(
    (change, index) => change.destructive && accepted.includes(index),
  )
  const applying = operation === 'apply'
  const canApply = patchValidation.valid && accepted.length > 0 && !applying

  return (
    <section
      className={`designer-patch-sheet ${applying ? 'is-busy' : ''}`}
      aria-label={t(locale, 'designer.patch.title')}
    >
      <header className="designer-patch-sheet-header">
        <div className="designer-patch-sheet-heading">
          <AppIcon name="sparkles" aria-hidden="true" />
          <span>{t(locale, 'designer.patch.title')}</span>
          <code className="designer-patch-count">
            {accepted.length}/{changes.length}
          </code>
        </div>
        <button
          type="button"
          className="designer-icon-button"
          onClick={onDismiss}
          aria-label={t(locale, 'designer.patch.dismiss')}
        >
          <AppIcon name="x-mark" aria-hidden="true" />
        </button>
      </header>

      <p className="designer-patch-summary">{patchValidation.patch.summary}</p>

      {destructiveSelected ? (
        <p className="designer-patch-warning">
          {t(locale, 'designer.patch.destructiveWarning')}
        </p>
      ) : null}

      <ul className="designer-patch-changes" role="list">
        {changes.map((change, index) => (
          <li
            key={`${change.op}:${change.blockId}:${index}`}
            className={`designer-patch-change ${change.destructive ? 'is-destructive' : ''} ${
              accepted.includes(index) ? 'is-accepted' : ''
            }`}
          >
            <label className="designer-patch-change-label">
              <input
                type="checkbox"
                checked={accepted.includes(index)}
                onChange={() => toggle(index)}
                disabled={applying}
              />
              <span className="designer-patch-change-op">{opLabel(locale, change.op)}</span>
              <span className="designer-patch-change-summary">{change.summary}</span>
            </label>
          </li>
        ))}
      </ul>

      {patchValidation.diagnostics.length > 0 ? (
        <ul className="designer-patch-diagnostics" role="list">
          {patchValidation.diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}:${index}`}
              className={`designer-patch-diagnostic is-${diagnostic.severity}`}
            >
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="designer-patch-sheet-footer">
        <button type="button" className="designer-tool-button" onClick={onDismiss} disabled={applying}>
          {t(locale, 'designer.patch.rejectAll')}
        </button>
        <button
          type="button"
          className="designer-tool-button designer-tool-button--accent"
          onClick={() => onApply(accepted)}
          disabled={!canApply}
        >
          {applying
            ? t(locale, 'designer.applying')
            : t(locale, 'designer.patch.applySelected', { count: accepted.length })}
        </button>
      </footer>
    </section>
  )
}
