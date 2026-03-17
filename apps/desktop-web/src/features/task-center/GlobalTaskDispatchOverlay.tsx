import { memo, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { AgentStation } from '@features/workspace-hub'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type {
  TaskCenterNotice,
  TaskDraftState,
  TaskMarkdownSnippet,
} from './task-center-model'
import type { TaskMentionFileCandidate } from './TaskCenterPane'
import { TaskCenterPane } from './TaskCenterPane'
import './GlobalTaskDispatchOverlay.scss'

interface GlobalTaskDispatchOverlayProps {
  open: boolean
  locale: Locale
  stations: AgentStation[]
  draft: TaskDraftState
  sending: boolean
  draftSavedAtMs: number | null
  notice: TaskCenterNotice | null
  mentionCandidates: TaskMentionFileCandidate[]
  mentionLoading: boolean
  mentionError: string | null
  shortcutLabel: string
  opacity: number
  onClose: () => void
  onOpacityChange: (value: number) => void
  onDraftChange: (patch: Partial<TaskDraftState>) => void
  onInsertSnippet: (snippet: TaskMarkdownSnippet) => void
  onSendTask: () => void
  onSearchMentionFiles: (query: string) => void
  onClearMentionSearch: () => void
}

function GlobalTaskDispatchOverlayView({
  open,
  locale,
  stations,
  draft,
  sending,
  draftSavedAtMs,
  notice,
  mentionCandidates,
  mentionLoading,
  mentionError,
  shortcutLabel,
  opacity,
  onClose,
  onOpacityChange,
  onDraftChange,
  onInsertSnippet,
  onSendTask,
  onSearchMentionFiles,
  onClearMentionSearch,
}: GlobalTaskDispatchOverlayProps) {
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const textarea = panelRef.current?.querySelector('textarea')
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus()
        const cursor = textarea.value.length
        textarea.setSelectionRange(cursor, cursor)
      }
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        onSendTask()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [onClose, onSendTask, open])

  const opacityLabel = useMemo(() => `${Math.round(opacity * 100)}%`, [opacity])
  const panelSurfaceOpacity = useMemo(
    () => `${Math.round((0.48 + (opacity - 0.55) * 0.75) * 100)}%`,
    [opacity],
  )
  const panelMutedOpacity = useMemo(
    () => `${Math.round((0.4 + (opacity - 0.55) * 0.68) * 100)}%`,
    [opacity],
  )
  const panelChromeOpacity = useMemo(
    () => `${Math.round((0.28 + (opacity - 0.55) * 0.42) * 100)}%`,
    [opacity],
  )
  const overlayVeilOpacity = useMemo(
    () => `${Math.round((0.14 + (opacity - 0.55) * 0.24) * 100)}%`,
    [opacity],
  )
  const overlayGlowOpacity = useMemo(
    () => `${Math.round((0.18 + (opacity - 0.55) * 0.2) * 100)}%`,
    [opacity],
  )

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="task-quick-dispatch-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        ref={panelRef}
        className="task-quick-dispatch-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, '全局任务派发', 'Global task dispatch')}
        style={
          {
            '--task-dispatch-panel-opacity': `${Math.round(opacity * 100)}%`,
            '--task-dispatch-panel-surface-opacity': panelSurfaceOpacity,
            '--task-dispatch-panel-muted-opacity': panelMutedOpacity,
            '--task-dispatch-panel-chrome-opacity': panelChromeOpacity,
            '--task-dispatch-overlay-veil-opacity': overlayVeilOpacity,
            '--task-dispatch-overlay-glow-opacity': overlayGlowOpacity,
          } as CSSProperties
        }
      >
        <header className="task-quick-dispatch-header">
          <div className="task-quick-dispatch-header-copy">
            <div className="task-quick-dispatch-kicker">
              <span>{t(locale, '任务中心', 'Task Center')}</span>
              <kbd>{shortcutLabel}</kbd>
            </div>
            <h2>{t(locale, '快速派发任务', 'Quick dispatch')}</h2>
            <p>
              {t(
                locale,
                '在任何界面直接选择 agent、编写任务并发送。支持 `@` 文件引用，并保留任务中心当前草稿。',
                'Choose agents, compose, and dispatch from anywhere. Supports `@` file mentions and keeps the current task draft.',
              )}
            </p>
          </div>
          <div className="task-quick-dispatch-header-actions">
            <label className="task-quick-dispatch-opacity">
              <span>{t(locale, '透明度', 'Opacity')}</span>
              <div className="task-quick-dispatch-opacity-control">
                <input
                  type="range"
                  min="0.55"
                  max="1"
                  step="0.01"
                  value={opacity}
                  onChange={(event) => {
                    onOpacityChange(Number(event.target.value))
                  }}
                />
                <strong>{opacityLabel}</strong>
              </div>
            </label>
            <button
              type="button"
              className="task-quick-dispatch-close"
              onClick={onClose}
              aria-label={t(locale, '关闭快速派发浮层', 'Close quick dispatch')}
            >
              <AppIcon name="close" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="task-quick-dispatch-body">
          <TaskCenterPane
            locale={locale}
            stations={stations}
            draft={draft}
            sending={sending}
            draftSavedAtMs={draftSavedAtMs}
            notice={notice}
            mentionCandidates={mentionCandidates}
            mentionLoading={mentionLoading}
            mentionError={mentionError}
            onDraftChange={onDraftChange}
            onInsertSnippet={onInsertSnippet}
            onSendTask={onSendTask}
            onSearchMentionFiles={onSearchMentionFiles}
            onClearMentionSearch={onClearMentionSearch}
            variant="overlay"
            showHeader={false}
            sendShortcutHint={t(locale, '按 Mod+Enter 立即发送', 'Press Mod+Enter to send')}
          />
        </div>
      </section>
    </div>,
    document.body,
  )
}

export const GlobalTaskDispatchOverlay = memo(GlobalTaskDispatchOverlayView)
