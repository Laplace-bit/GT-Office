import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { DEFAULT_TASK_QUICK_DISPATCH_OPACITY } from './task-center-model'
import {
  clampQuickDispatchRailPosition,
  parseQuickDispatchRailPrefs,
  QUICK_DISPATCH_RAIL_STORAGE_KEY,
  resolveDefaultQuickDispatchRailPosition,
  resolveTaskTargetIdsForDispatch,
  serializeQuickDispatchRailPrefs,
  type QuickDispatchRailPosition,
  type QuickDispatchRailPrefs,
} from './global-task-dispatch-rail-state'
import './GlobalTaskDispatchOverlay.scss'

const DEFAULT_RAIL_SIZE = {
  width: 480,
  height: 200,
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

function loadRailPrefs(): QuickDispatchRailPrefs {
  if (typeof window === 'undefined') {
    return parseQuickDispatchRailPrefs(null)
  }
  try {
    return parseQuickDispatchRailPrefs(window.localStorage.getItem(QUICK_DISPATCH_RAIL_STORAGE_KEY))
  } catch {
    return parseQuickDispatchRailPrefs(null)
  }
}

function saveRailPrefs(prefs: QuickDispatchRailPrefs): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(QUICK_DISPATCH_RAIL_STORAGE_KEY, serializeQuickDispatchRailPrefs(prefs))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

interface GlobalTaskDispatchOverlayProps {
  open: boolean
  locale: Locale
  stations: AgentStation[]
  activeStationId?: string | null
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
  onPinnedChange?: (pinned: boolean) => void
}

function GlobalTaskDispatchOverlayView({
  open,
  locale,
  stations,
  activeStationId = null,
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
  onPinnedChange,
}: GlobalTaskDispatchOverlayProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const positionRef = useRef<QuickDispatchRailPosition | null>(null)
  const panelSizeRef = useRef(DEFAULT_RAIL_SIZE)
  const prefsRef = useRef<QuickDispatchRailPrefs>(loadRailPrefs())
  const dragSessionRef = useRef<{
    pointerId: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const [position, setPosition] = useState<QuickDispatchRailPosition | null>(null)
  const [dragging, setDragging] = useState(false)
  const [utilityOpen, setUtilityOpen] = useState(false)
  const [enterToSend, setEnterToSend] = useState(() => loadRailPrefs().enterToSend)
  const [pinned, setPinned] = useState(() => loadRailPrefs().pinned)
  const [followActiveAgent, setFollowActiveAgent] = useState(
    () => loadRailPrefs().followActiveAgent,
  )

  const persistPrefs = useCallback((patch: Partial<QuickDispatchRailPrefs>) => {
    const next: QuickDispatchRailPrefs = {
      ...prefsRef.current,
      ...patch,
      position: patch.position === undefined ? prefsRef.current.position : patch.position,
    }
    prefsRef.current = next
    saveRailPrefs(next)
  }, [])

  const handleEnterToSendChange = useCallback(
    (next: boolean) => {
      setEnterToSend(next)
      persistPrefs({ enterToSend: next })
    },
    [persistPrefs],
  )

  const handleFollowActiveAgentChange = useCallback(
    (next: boolean) => {
      setFollowActiveAgent(next)
      persistPrefs({ followActiveAgent: next })
      if (next) {
        const nextTargets = resolveTaskTargetIdsForDispatch({
          stations,
          activeStationId,
          currentTargetIds: draft.targetStationIds,
          followActiveAgent: true,
        })
        onDraftChange({ targetStationIds: nextTargets })
      }
    },
    [activeStationId, draft.targetStationIds, onDraftChange, persistPrefs, stations],
  )

  const handlePinnedChange = useCallback(
    (next: boolean) => {
      setPinned(next)
      persistPrefs({ pinned: next })
      onPinnedChange?.(next)
    },
    [onPinnedChange, persistPrefs],
  )

  const handleClose = useCallback(() => {
    if (pinned) {
      handlePinnedChange(false)
    }
    onClose()
  }, [handlePinnedChange, onClose, pinned])

  // Follow mode UI sync: shell controller also locks targets on activeStationId
  // change; this keeps the open overlay responsive when the checkbox is toggled
  // or when open becomes true with follow enabled.
  useEffect(() => {
    if (!open || !followActiveAgent) {
      return
    }
    const nextTargets = resolveTaskTargetIdsForDispatch({
      stations,
      activeStationId,
      currentTargetIds: draft.targetStationIds,
      followActiveAgent: true,
    })
    if (
      nextTargets.length === draft.targetStationIds.length &&
      nextTargets.every((id, index) => id === draft.targetStationIds[index])
    ) {
      return
    }
    onDraftChange({ targetStationIds: nextTargets })
  }, [
    activeStationId,
    draft.targetStationIds,
    followActiveAgent,
    onDraftChange,
    open,
    stations,
  ])

  // Non-follow mode: only heal empty / invalid targets while the overlay is open.
  useEffect(() => {
    if (!open || followActiveAgent) {
      return
    }
    const nextTargets = resolveTaskTargetIdsForDispatch({
      stations,
      activeStationId,
      currentTargetIds: draft.targetStationIds,
      followActiveAgent: false,
    })
    if (
      nextTargets.length === draft.targetStationIds.length &&
      nextTargets.every((id, index) => id === draft.targetStationIds[index])
    ) {
      return
    }
    onDraftChange({ targetStationIds: nextTargets })
  }, [
    activeStationId,
    draft.targetStationIds,
    followActiveAgent,
    onDraftChange,
    open,
    stations,
  ])

  useEffect(() => {
    if (!open) {
      setUtilityOpen(false)
      setDragging(false)
      if (!pinned) {
        setPosition(null)
        positionRef.current = null
      }
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
        if (pinned) {
          return
        }
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
  }, [onClose, onSendTask, open, pinned])

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
        prefsRef.current.position ??
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
      syncRailPosition(prefsRef.current.position)
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
  }, [open])

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
        persistPrefs({ position: positionRef.current })
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
  }, [open, persistPrefs])

  const opacityPercent = useMemo(() => Math.round(opacity * 100), [opacity])
  const opacityLabel = useMemo(() => `${opacityPercent}%`, [opacityPercent])
  const targetSummary = useMemo(() => {
    const count = draft.targetStationIds.length
    if (count <= 0) {
      return t(locale, '未选目标', 'No target')
    }
    if (count === 1) {
      const station = stations.find((item) => item.id === draft.targetStationIds[0])
      return station?.name ?? t(locale, '1 个目标', '1 target')
    }
    return t(locale, `${count} 个目标`, `${count} targets`)
  }, [draft.targetStationIds, locale, stations])

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="task-quick-dispatch-overlay">
      <section
        ref={panelRef}
        className={`task-quick-dispatch-panel ${dragging ? 'dragging' : ''} ${position ? 'is-positioned' : ''} ${pinned ? 'is-pinned' : ''} ${opacity <= 0.02 ? 'is-fully-transparent' : ''}`}
        role="complementary"
        aria-label={t(locale, '全局任务派发', 'Global task dispatch')}
        style={
          {
            '--task-dispatch-alpha': String(opacity),
            '--task-dispatch-panel-left': position ? `${position.left}px` : undefined,
            '--task-dispatch-panel-top': position ? `${position.top}px` : undefined,
          } as CSSProperties
        }
      >
        <div className="task-quick-dispatch-panel-surface" aria-hidden="true" />
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
              className={`task-quick-dispatch-icon-btn ${pinned ? 'active' : ''}`}
              onClick={() => {
                handlePinnedChange(!pinned)
              }}
              aria-label={
                pinned
                  ? t(locale, '取消置顶', 'Unpin quick dispatch')
                  : t(locale, '置顶钉住', 'Pin quick dispatch')
              }
              aria-pressed={pinned}
              title={
                pinned
                  ? t(locale, '取消置顶', 'Unpin')
                  : t(locale, '置顶钉住', 'Pin')
              }
            >
              <AppIcon name="pin" aria-hidden="true" />
            </button>
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
              onClick={handleClose}
              aria-label={t(locale, '关闭快速派发浮层', 'Close quick dispatch')}
            >
              <AppIcon name="close" aria-hidden="true" />
            </button>
          </div>
        </header>

        {utilityOpen ? (
          <div className="task-quick-dispatch-utility">
            <div className="task-quick-dispatch-opacity">
              <span className="task-quick-dispatch-opacity-label">
                {t(locale, '背景不透明度', 'Background opacity')}
              </span>
              <div className="task-quick-dispatch-opacity-control">
                <span className="task-quick-dispatch-opacity-end" aria-hidden="true">
                  {t(locale, '透明', 'Clear')}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={opacityPercent}
                  aria-label={t(locale, '背景不透明度', 'Background opacity')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={opacityPercent}
                  aria-valuetext={opacityLabel}
                  onInput={(event) => {
                    onOpacityChange(Number(event.currentTarget.value) / 100)
                  }}
                  onChange={(event) => {
                    onOpacityChange(Number(event.currentTarget.value) / 100)
                  }}
                  onDoubleClick={() => {
                    onOpacityChange(DEFAULT_TASK_QUICK_DISPATCH_OPACITY)
                  }}
                />
                <span className="task-quick-dispatch-opacity-end" aria-hidden="true">
                  {t(locale, '实色', 'Solid')}
                </span>
                <button
                  type="button"
                  className="task-quick-dispatch-opacity-value"
                  title={t(locale, '双击滑条可恢复默认', 'Double-click slider to reset')}
                  onClick={() => {
                    onOpacityChange(DEFAULT_TASK_QUICK_DISPATCH_OPACITY)
                  }}
                >
                  {opacityLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="task-quick-dispatch-body">
          <TaskCenterPane
            locale={locale}
            stations={stations}
            activeStationId={activeStationId}
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
            enterToSend={enterToSend}
            onEnterToSendChange={handleEnterToSendChange}
            followActiveAgent={followActiveAgent}
            onFollowActiveAgentChange={handleFollowActiveAgentChange}
            sendShortcutHint={
              enterToSend
                ? t(locale, 'Enter 发送 · Shift+Enter 换行', 'Enter send · Shift+Enter newline')
                : t(locale, 'Mod+Enter 发送', 'Mod+Enter to send')
            }
          />
        </div>
      </section>
    </div>,
    document.body,
  )
}

export const GlobalTaskDispatchOverlay = memo(GlobalTaskDispatchOverlayView)

export function readQuickDispatchPinnedFromStorage(): boolean {
  return loadRailPrefs().pinned
}
