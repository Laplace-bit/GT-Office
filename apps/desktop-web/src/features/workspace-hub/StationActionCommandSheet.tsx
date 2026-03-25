import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { AgentStation } from './station-model'
import {
  composeStationActionCommand,
  type StationActionArgument,
  type StationActionDescriptor,
} from './station-action-model'
import { resolveCommandSheetInitialFocusTarget } from './station-action-command-sheet-focus'
import './StationActionCommandSheet.scss'

interface StationActionCommandSheetProps {
  locale: Locale
  station: AgentStation | null
  action: StationActionDescriptor | null
  open: boolean
  onClose: () => void
  onSubmit: (values: Record<string, string | boolean>) => void
}

function normalizeArgumentValue(argument: StationActionArgument): string | boolean {
  if (argument.kind === 'boolean') {
    return argument.defaultValue === 'true'
  }
  if (argument.defaultValue && argument.defaultValue.length > 0) {
    return argument.defaultValue
  }
  return argument.options[0]?.value ?? ''
}

function ActionField({
  argument,
  value,
  onChange,
}: {
  argument: StationActionArgument
  value: string | boolean
  onChange: (nextValue: string | boolean) => void
}) {
  const inputId = `station-action-field-${argument.name}`

  if (argument.kind === 'enum') {
    return (
      <label className="station-action-command-sheet-field" htmlFor={inputId}>
        <span className="station-action-command-sheet-field-label">{argument.label}</span>
        <select
          id={inputId}
          className="station-action-command-sheet-control"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {argument.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (argument.kind === 'multiline_text') {
    return (
      <label className="station-action-command-sheet-field" htmlFor={inputId}>
        <span className="station-action-command-sheet-field-label">{argument.label}</span>
        <textarea
          id={inputId}
          className="station-action-command-sheet-control station-action-command-sheet-control-textarea"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={argument.placeholder ?? undefined}
          rows={4}
        />
      </label>
    )
  }

  if (argument.kind === 'boolean') {
    return (
      <label className="station-action-command-sheet-toggle" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{argument.label}</span>
      </label>
    )
  }

  const inputType = argument.kind === 'duration' ? 'text' : 'text'

  return (
    <label className="station-action-command-sheet-field" htmlFor={inputId}>
      <span className="station-action-command-sheet-field-label">{argument.label}</span>
      <input
        id={inputId}
        type={inputType}
        className="station-action-command-sheet-control"
        value={String(value ?? '')}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        placeholder={argument.placeholder ?? undefined}
      />
    </label>
  )
}

function StationActionCommandSheetView({
  locale,
  station,
  action,
  open,
  onClose,
  onSubmit,
}: StationActionCommandSheetProps) {
  const sheetRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const submitButtonRef = useRef<HTMLButtonElement | null>(null)
  const initialValues = useMemo(() => {
    if (!action) {
      return {}
    }
    return (action.arguments ?? []).reduce<Record<string, string | boolean>>((acc, argument) => {
      acc[argument.name] = normalizeArgumentValue(argument)
      return acc
    }, {})
  }, [action])
  const [values, setValues] = useState<Record<string, string | boolean>>(initialValues)

  useEffect(() => {
    if (!open) {
      return
    }
    setValues(initialValues)
  }, [initialValues, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.requestAnimationFrame(() => {
      const sheet = sheetRef.current
      const firstField = sheet?.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      const target = resolveCommandSheetInitialFocusTarget({
        hasEditableField: Boolean(firstField),
        isSubmitDisabled: Boolean(submitButtonRef.current?.disabled),
      })

      if (target === 'field') {
        firstField?.focus()
        return
      }

      if (target === 'submit') {
        submitButtonRef.current?.focus()
        return
      }

      closeButtonRef.current?.focus()
    })
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open || !action || action.execution.type !== 'open_command_sheet') {
    return null
  }

  const preview = composeStationActionCommand(action, values)
  const hasRequiredError = (action.arguments ?? []).some((argument) => {
    if (!argument.required) {
      return false
    }
    if (argument.kind === 'boolean') {
      return false
    }
    const value = String(values[argument.name] ?? '').trim()
    return value.length === 0
  })

  return (
    <div className="station-action-command-sheet-backdrop" onClick={onClose}>
      <section
        ref={sheetRef}
        className="station-action-command-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="station-action-command-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="station-action-command-sheet-header">
          <div className="station-action-command-sheet-header-copy">
            <span className="station-action-command-sheet-eyebrow">
              {t(locale, '命令参数', 'Command Setup')}
            </span>
            <h2 id="station-action-command-sheet-title">{action.label}</h2>
            <p>
              {station
                ? t(locale, `发送到 ${station.name}`, `Send to ${station.name}`)
                : t(locale, '准备命令', 'Prepare the command')}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="station-action-command-sheet-close"
            onClick={onClose}
            aria-label={t(locale, '关闭', 'Close')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <form
          className="station-action-command-sheet-body"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            if (hasRequiredError) {
              return
            }
            onSubmit(values)
          }}
        >
          {(action.arguments ?? []).length > 0 ? (
            <div className="station-action-command-sheet-fields">
              {(action.arguments ?? []).map((argument) => (
                <ActionField
                  key={argument.name}
                  argument={argument}
                  value={values[argument.name] ?? normalizeArgumentValue(argument)}
                  onChange={(nextValue) => {
                    setValues((prev) => ({
                      ...prev,
                      [argument.name]: nextValue,
                    }))
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="station-action-command-sheet-empty">
              <strong>{t(locale, '即将执行该命令。', 'This command will run immediately.')}</strong>
              <p>{t(locale, '这个动作没有额外参数，但会先通过这里确认。', 'This action has no extra fields, but it still requires confirmation here.')}</p>
            </div>
          )}

          <div className="station-action-command-sheet-preview">
            <span>{t(locale, '命令预览', 'Preview')}</span>
            <code>{preview}</code>
          </div>

          <footer className="station-action-command-sheet-footer">
            <button type="button" className="station-action-command-sheet-secondary" onClick={onClose}>
              {t(locale, '取消', 'Cancel')}
            </button>
            <button
              ref={submitButtonRef}
              type="submit"
              className={[
                'station-action-command-sheet-primary',
                action.dangerLevel === 'confirm' ? 'is-confirm' : '',
                action.dangerLevel === 'expensive' ? 'is-expensive' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={hasRequiredError}
            >
              {t(locale, '执行命令', 'Run Command')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export const StationActionCommandSheet = memo(StationActionCommandSheetView)
