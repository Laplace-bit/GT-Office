import { useEffect, useMemo, useState } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import type { ShortcutBinding } from '@features/keybindings'
import {
  createShortcutBindingFromKeyboardEvent,
  formatShortcutBinding,
} from '@features/keybindings'
import './TaskDispatchPreferences.scss'

interface TaskDispatchPreferencesProps {
  locale: Locale
  isMacOs: boolean
  shortcut: ShortcutBinding
  defaultShortcut: ShortcutBinding
  onShortcutChange: (binding: ShortcutBinding) => void
  onShortcutReset: () => void
}

export function TaskDispatchPreferences({
  locale,
  isMacOs,
  shortcut,
  defaultShortcut,
  onShortcutChange,
  onShortcutReset,
}: TaskDispatchPreferencesProps) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    if (recording) {
      document.body.dataset.gtoShortcutRecording = 'true'
      return () => {
        delete document.body.dataset.gtoShortcutRecording
      }
    }
    delete document.body.dataset.gtoShortcutRecording
    return undefined
  }, [recording])

  useEffect(() => {
    if (!recording) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(false)
        return
      }

      const nextBinding = createShortcutBindingFromKeyboardEvent(event, isMacOs)
      if (!nextBinding) {
        return
      }
      onShortcutChange(nextBinding)
      setRecording(false)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [isMacOs, onShortcutChange, recording])

  const shortcutLabel = useMemo(
    () => formatShortcutBinding(shortcut, isMacOs),
    [isMacOs, shortcut],
  )
  const defaultShortcutLabel = useMemo(
    () => formatShortcutBinding(defaultShortcut, isMacOs),
    [defaultShortcut, isMacOs],
  )

  return (
    <div className="task-dispatch-preferences">
      <div className="settings-group">
        <div className="settings-row task-dispatch-preferences-row">
          <div className="settings-row-label">
            <strong>{t(locale, '快速派发任务', 'Quick dispatch')}</strong>
            <span>
              {t(
                locale,
                '默认使用 {shortcut}，可在任何界面拉起任务派发浮层。',
                'Defaults to {shortcut} and opens the dispatch overlay from anywhere. ',
                { shortcut: defaultShortcutLabel },
              )}
            </span>
          </div>
          <div className="settings-row-control task-dispatch-shortcut-control">
            <button
              type="button"
              className={`task-dispatch-shortcut-chip ${recording ? 'is-recording' : ''}`}
              onClick={() => {
                setRecording((prev) => !prev)
              }}
            >
              {recording
                ? t(locale, '按下新的快捷键', 'Press a new shortcut')
                : shortcutLabel}
            </button>
            <button
              type="button"
              className="task-dispatch-secondary-button"
              onClick={onShortcutReset}
            >
              {t(locale, '恢复默认', 'Reset')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
