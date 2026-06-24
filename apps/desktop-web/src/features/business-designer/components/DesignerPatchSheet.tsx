import { useEffect, useMemo, useRef, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { DesignerGapResolution, DesignerPatchValidationResult } from '../model/designer-patch'
import type { DesignerOperation } from '../controllers/useDesignerDocumentState'

interface DesignerPatchSheetProps {
  locale: Locale
  patchValidation: DesignerPatchValidationResult | null
  operation: DesignerOperation | null
  /** v1: most recent gap resolution from `apply_agent_patch`. */
  gapResolution?: DesignerGapResolution | null
  onApply: (acceptedChangeIndices: number[]) => void
  onCheckpoint?: () => void
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
  gapResolution,
  onApply,
  onCheckpoint,
  onDismiss,
}: DesignerPatchSheetProps) {
  const changes = patchValidation?.changes ?? []
  const sheetRef = useRef<HTMLElement | null>(null)
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

  useEffect(() => {
    if (!patchValidation) {
      return
    }
    const sheet = sheetRef.current
    const firstControl =
      sheet?.querySelector<HTMLInputElement>('.designer-patch-change input') ??
      sheet?.querySelector<HTMLButtonElement>('button')
    firstControl?.focus()
  }, [patchValidation])

  useEffect(() => {
    if (!patchValidation) {
      return
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [patchValidation, onDismiss])

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
      ref={sheetRef}
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

      {gapResolution &&
      (gapResolution.resolved.length > 0 ||
        gapResolution.unresolved.length > 0 ||
        gapResolution.incidentalResolved.length > 0 ||
        gapResolution.introduced.length > 0) ? (
        <div className="designer-patch-resolution">
          <h4 className="designer-patch-resolution-title">
            {t(locale, 'designer.patch.resolution.title')}
          </h4>
          {gapResolution.resolved.length > 0 ? (
            <div className="designer-patch-resolution-row is-resolved">
              <AppIcon name="check-circle" aria-hidden="true" />
              <span>
                {t(locale, 'designer.patch.resolution.resolved', {
                  count: gapResolution.resolved.length,
                  plural: gapResolution.resolved.length === 1 ? '' : 's',
                })}
              </span>
            </div>
          ) : null}
          {gapResolution.unresolved.length > 0 ? (
            <div className="designer-patch-resolution-row is-unresolved">
              <AppIcon name="alert-triangle" aria-hidden="true" />
              <span>
                {t(locale, 'designer.patch.resolution.unresolved', {
                  count: gapResolution.unresolved.length,
                })}
              </span>
            </div>
          ) : null}
          {gapResolution.incidentalResolved.length > 0 ? (
            <div className="designer-patch-resolution-row is-incidental-resolved">
              <AppIcon name="check-circle" aria-hidden="true" />
              <span>
                {t(locale, 'designer.patch.resolution.incidentalResolved', {
                  count: gapResolution.incidentalResolved.length,
                  plural: gapResolution.incidentalResolved.length === 1 ? '' : 's',
                })}
              </span>
            </div>
          ) : null}
          {gapResolution.introduced.length > 0 ? (
            <div className="designer-patch-resolution-row is-introduced">
              <AppIcon name="alert-circle" aria-hidden="true" />
              <span>
                {t(locale, 'designer.patch.resolution.introduced', {
                  count: gapResolution.introduced.length,
                  plural: gapResolution.introduced.length === 1 ? '' : 's',
                })}
              </span>
            </div>
          ) : null}
          {onCheckpoint ? (
            <button
              type="button"
              className="designer-tool-button designer-patch-resolution-checkpoint"
              onClick={onCheckpoint}
              disabled={applying}
            >
              <AppIcon name="git-commit" aria-hidden="true" />
              <span>{t(locale, 'designer.patch.resolution.checkpoint')}</span>
            </button>
          ) : null}
        </div>
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
