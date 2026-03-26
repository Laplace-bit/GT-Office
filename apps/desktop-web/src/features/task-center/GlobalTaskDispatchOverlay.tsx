import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import {
  clampQuickDispatchRailPosition,
  parseQuickDispatchRailSnapshot,
  QUICK_DISPATCH_RAIL_STORAGE_KEY,
  resolveDefaultQuickDispatchRailPosition,
  resolveQuickDispatchRailExpandedState,
  serializeQuickDispatchRailSnapshot,
  type QuickDispatchRailPosition,
} from './global-task-dispatch-rail-state'
import './GlobalTaskDispatchOverlay.scss'

const DEFAULT_RAIL_SIZE = {
  width: 448,
  height: 148,
}

const QUICK_DISPATCH_RAIL_MARGIN = 20

function areRailPositionsEqual(
  left: QuickDispatchRailPosition | null,
  right: QuickDispatchRailPosition | null,
): boolean {
  if (!left || !right) {
    return left === right
  }
  return left.left === right.left && left.top === right.top
}

function loadRememberedRailPosition(): QuickDispatchRailPosition | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(QUICK_DISPATCH_RAIL_STORAGE_KEY)
  if (!raw) {
    return null
  }

  return parseQuickDispatchRailSnapshot(raw)?.position ?? null
}

function saveRememberedRailPosition(position: QuickDispatchRailPosition): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    QUICK_DISPATCH_RAIL_STORAGE_KEY,
    serializeQuickDispatchRailSnapshot({
      version: 1,
      position,
    }),
  )
}

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
  const positionRef = useRef<QuickDispatchRailPosition | null>(null)
  const panelSizeRef = useRef(DEFAULT_RAIL_SIZE)
  const dragSessionRef = useRef<{
    pointerId: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const [position, setPosition] = useState<QuickDispatchRailPosition | null>(null)
  const [editorFocused, setEditorFocused] = useState(false)
  const [retainedWhileFocused, setRetainedWhileFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [utilityOpen, setUtilityOpen] = useState(false)

  const railExpandedState = useMemo(
    () =>
      resolveQuickDispatchRailExpandedState({
        retainedWhileFocused,
        focused: editorFocused,
        markdown: draft.markdown,
        sending,
        hasNotice: Boolean(notice),
        targetPickerOpen: false,
        mentionOpen: false,
      }),
    [draft.markdown, editorFocused, notice, retainedWhileFocused, sending],
  )

  useEffect(() => {
    if (railExpandedState.retainedWhileFocused !== retainedWhileFocused) {
      setRetainedWhileFocused(railExpandedState.retainedWhileFocused)
    }
  }, [railExpandedState.retainedWhileFocused, retainedWhileFocused])

  const expanded = railExpandedState.expanded || utilityOpen

  useEffect(() => {
    if (!open) {
      setEditorFocused(false)
      setRetainedWhileFocused(false)
      setUtilityOpen(false)
      setDragging(false)
      setPosition(null)
      positionRef.current = null
      dragSessionRef.current = null
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

  useEffect(() => {
    if (!open) {
      return
    }

    const panel = panelRef.current
    if (!panel) {
      return
    }

    const syncRailPosition = (
      preferredPosition: QuickDispatchRailPosition | null,
      preserveBottomEdge = false,
    ) => {
      const rect = panel.getBoundingClientRect()
      const size = {
        width: Math.round(rect.width || DEFAULT_RAIL_SIZE.width),
        height: Math.round(rect.height || DEFAULT_RAIL_SIZE.height),
      }
      const fallbackPosition = resolveDefaultQuickDispatchRailPosition({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        railWidth: size.width,
        railHeight: size.height,
        margin: QUICK_DISPATCH_RAIL_MARGIN,
      })
      const currentPosition =
        preferredPosition ??
        positionRef.current ??
        loadRememberedRailPosition() ??
        fallbackPosition
      const baselineTop =
        preserveBottomEdge && positionRef.current
          ? currentPosition.top - (size.height - panelSizeRef.current.height)
          : currentPosition.top
      const nextPosition = clampQuickDispatchRailPosition({
        position: {
          left: currentPosition.left,
          top: baselineTop,
        },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        railWidth: size.width,
        railHeight: size.height,
        margin: QUICK_DISPATCH_RAIL_MARGIN,
      })

      panelSizeRef.current = size

      if (!areRailPositionsEqual(positionRef.current, nextPosition)) {
        positionRef.current = nextPosition
        setPosition(nextPosition)
      }
    }

    const frame = window.requestAnimationFrame(() => {
      syncRailPosition(loadRememberedRailPosition())
    })

    const resizeObserver = new ResizeObserver(() => {
      if (dragSessionRef.current) {
        return
      }
      syncRailPosition(positionRef.current, true)
    })

    const onViewportResize = () => {
      syncRailPosition(positionRef.current)
    }

    resizeObserver.observe(panel)
    window.addEventListener('resize', onViewportResize)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', onViewportResize)
    }
  }, [expanded, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      const dragSession = dragSessionRef.current
      const panel = panelRef.current
      if (!dragSession || !panel || event.pointerId !== dragSession.pointerId) {
        return
      }

      const rect = panel.getBoundingClientRect()
      const nextPosition = clampQuickDispatchRailPosition({
        position: {
          left: event.clientX - dragSession.offsetX,
          top: event.clientY - dragSession.offsetY,
        },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        railWidth: Math.round(rect.width || panelSizeRef.current.width),
        railHeight: Math.round(rect.height || panelSizeRef.current.height),
        margin: QUICK_DISPATCH_RAIL_MARGIN,
      })

      panelSizeRef.current = {
        width: Math.round(rect.width || panelSizeRef.current.width),
        height: Math.round(rect.height || panelSizeRef.current.height),
      }
      positionRef.current = nextPosition
      setPosition(nextPosition)
    }

    const finishDrag = (event?: PointerEvent) => {
      if (
        !dragSessionRef.current ||
        (event && event.pointerId !== dragSessionRef.current.pointerId)
      ) {
        return
      }

      dragSessionRef.current = null
      setDragging(false)
      if (positionRef.current) {
        saveRememberedRailPosition(positionRef.current)
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
    }
  }, [open])

  const opacityLabel = useMemo(() => `${Math.round(opacity * 100)}%`, [opacity])
  const panelSurfaceOpacity = useMemo(
    () => `${Math.round((0.74 + (opacity - 0.55) * 0.42) * 100)}%`,
    [opacity],
  )
  const panelMutedOpacity = useMemo(
    () => `${Math.round((0.68 + (opacity - 0.55) * 0.36) * 100)}%`,
    [opacity],
  )
  const panelChromeOpacity = useMemo(() => `${Math.round((0.2 + (opacity - 0.55) * 0.3) * 100)}%`, [opacity])
  const panelBorderOpacity = useMemo(() => `${Math.round((0.24 + (opacity - 0.55) * 0.28) * 100)}%`, [opacity])
  const sideTintOpacity = useMemo(() => `${Math.round((0.06 + (opacity - 0.55) * 0.16) * 100)}%`, [opacity])
  const targetSummary = useMemo(() => {
    const count = draft.targetStationIds.length
    if (count <= 0) {
      return t(locale, '未选目标', 'No target')
    }
    if (count === 1) {
      return t(locale, '1 个目标', '1 target')
    }
    return t(locale, `${count} 个目标`, `${count} targets`)
  }, [draft.targetStationIds.length, locale])

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="task-quick-dispatch-overlay">
      <section
        ref={panelRef}
        className={`task-quick-dispatch-panel ${expanded ? 'expanded' : 'compact'} ${dragging ? 'dragging' : ''} ${position ? 'is-positioned' : ''}`}
        role="complementary"
        aria-label={t(locale, '全局任务派发', 'Global task dispatch')}
        style={
          {
            '--task-dispatch-panel-opacity': `${Math.round(opacity * 100)}%`,
            '--task-dispatch-panel-surface-opacity': panelSurfaceOpacity,
            '--task-dispatch-panel-muted-opacity': panelMutedOpacity,
            '--task-dispatch-panel-chrome-opacity': panelChromeOpacity,
            '--task-dispatch-panel-border-opacity': panelBorderOpacity,
            '--task-dispatch-side-tint-opacity': sideTintOpacity,
            '--task-dispatch-panel-left': position ? `${position.left}px` : undefined,
            '--task-dispatch-panel-top': position ? `${position.top}px` : undefined,
          } as CSSProperties
        }
      >
        <header className="task-quick-dispatch-rail-head">
          <button
            type="button"
            className="task-quick-dispatch-drag-handle"
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return
              }
              event.preventDefault()

              const panel = panelRef.current
              if (!panel) {
                return
              }

              const rect = panel.getBoundingClientRect()
              const activePosition =
                positionRef.current ??
                clampQuickDispatchRailPosition({
                  position: {
                    left: rect.left,
                    top: rect.top,
                  },
                  viewportWidth: window.innerWidth,
                  viewportHeight: window.innerHeight,
                  railWidth: Math.round(rect.width || panelSizeRef.current.width),
                  railHeight: Math.round(rect.height || panelSizeRef.current.height),
                  margin: QUICK_DISPATCH_RAIL_MARGIN,
                })

              positionRef.current = activePosition
              setPosition(activePosition)
              dragSessionRef.current = {
                pointerId: event.pointerId,
                offsetX: event.clientX - activePosition.left,
                offsetY: event.clientY - activePosition.top,
              }
              setDragging(true)
            }}
            aria-label={t(locale, '拖动快速派发位置', 'Drag quick dispatch')}
          >
            <span className="task-quick-dispatch-grip" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="task-quick-dispatch-handle-copy">
              <strong>{t(locale, '快速派发', 'Quick dispatch')}</strong>
              <em>{targetSummary}</em>
            </span>
          </button>
          <div className="task-quick-dispatch-header-actions">
            <kbd className="task-quick-dispatch-shortcut">{shortcutLabel}</kbd>
            <button
              type="button"
              className={`task-quick-dispatch-icon-btn ${utilityOpen ? 'active' : ''}`}
              onClick={() => {
                setUtilityOpen((previous) => !previous)
              }}
              aria-label={t(locale, '显示快速派发工具', 'Toggle quick dispatch utilities')}
              aria-pressed={utilityOpen}
            >
              <AppIcon name="settings" aria-hidden="true" />
            </button>
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

        {expanded ? (
          <div className="task-quick-dispatch-meta-row">
            <span className="task-quick-dispatch-meta-copy">
              {t(locale, '输入时展开，拖动后会记住位置。', 'Type to expand. Drag to remember the rail position.')}
            </span>
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
          </div>
        ) : null}

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
            compact={!expanded}
            showHeader={false}
            sendShortcutHint={t(locale, '按 Mod+Enter 立即发送', 'Press Mod+Enter to send')}
            onEditorFocusChange={setEditorFocused}
          />
        </div>
      </section>
    </div>,
    document.body,
  )
}

export const GlobalTaskDispatchOverlay = memo(GlobalTaskDispatchOverlayView)
