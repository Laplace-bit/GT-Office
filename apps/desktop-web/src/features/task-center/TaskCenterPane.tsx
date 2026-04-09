import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@shell/ui/icons'
import type { AgentStation } from '@features/workspace-hub'
import {
  toggleTaskTarget,
  type TaskCenterNotice,
  type TaskDraftState,
  type TaskMarkdownSnippet,
} from './task-center-model'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import './TaskCenterPane.scss'

export interface TaskMentionFileCandidate {
  path: string
  name: string
}

interface TaskCenterPaneProps {
  locale: Locale
  stations: AgentStation[]
  draft: TaskDraftState
  sending: boolean
  draftSavedAtMs: number | null
  notice: TaskCenterNotice | null
  mentionCandidates: TaskMentionFileCandidate[]
  mentionLoading: boolean
  mentionError: string | null
  onDraftChange: (patch: Partial<TaskDraftState>) => void
  onInsertSnippet: (snippet: TaskMarkdownSnippet) => void
  onSendTask: () => void
  onSearchMentionFiles: (query: string) => void
  onClearMentionSearch: () => void
  variant?: 'pane' | 'overlay'
  compact?: boolean
  showHeader?: boolean
  title?: string
  description?: string | null
  sendShortcutHint?: string | null
  onEditorFocusChange?: (focused: boolean) => void
}

interface MentionRange {
  start: number
  end: number
  query: string
}

interface MentionPopoverStyle {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

function resolveMentionRange(value: string, cursor: number): MentionRange | null {
  if (cursor <= 0) {
    return null
  }
  const atIndex = value.lastIndexOf('@', cursor - 1)
  if (atIndex < 0) {
    return null
  }
  const leading = atIndex > 0 ? value[atIndex - 1] : ''
  if (leading && /[\w./-]/.test(leading)) {
    return null
  }
  const query = value.slice(atIndex + 1, cursor)
  if (!query || /\s/.test(query)) {
    return null
  }
  return {
    start: atIndex,
    end: cursor,
    query,
  }
} 

const DEFAULT_ROOT_FONT_SIZE = 14

function getRootFontSize(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_ROOT_FONT_SIZE
  }
  const value = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ROOT_FONT_SIZE
}

function toRem(value: number): string {
  return `${value / getRootFontSize()}rem`
}

function resolveTextareaCaretViewportPosition(textarea: HTMLTextAreaElement, cursor: number) {
  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const style = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()

  const propertiesToCopy = [
    'boxSizing',
    'width',
    'height',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'textIndent',
    'tabSize',
  ] as const

  mirror.style.position = 'fixed'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.overflow = 'hidden'

  propertiesToCopy.forEach((property) => {
    mirror.style[property] = style[property]
  })

  mirror.textContent = textarea.value.slice(0, cursor)
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const markerRect = marker.getBoundingClientRect()
  const fallbackLineHeight = Number.parseFloat(style.lineHeight) || 20
  const top = rect.top + (markerRect.top - mirror.getBoundingClientRect().top) - textarea.scrollTop
  const left = rect.left + (markerRect.left - mirror.getBoundingClientRect().left) - textarea.scrollLeft

  document.body.removeChild(mirror)

  return {
    top,
    left,
    lineHeight: fallbackLineHeight,
    textareaRect: rect,
  }
}

function TaskCenterPaneView({
  locale,
  stations,
  draft,
  sending,
  draftSavedAtMs: _draftSavedAtMs,
  notice,
  mentionCandidates,
  mentionLoading,
  mentionError,
  onDraftChange,
  onInsertSnippet: _onInsertSnippet,
  onSendTask,
  onSearchMentionFiles,
  onClearMentionSearch,
  variant = 'pane',
  compact = false,
  showHeader = true,
  title,
  description = null,
  sendShortcutHint = null,
  onEditorFocusChange,
}: TaskCenterPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const targetTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mentionQueryRef = useRef('')
  const [mentionRange, setMentionRange] = useState<MentionRange | null>(null)
  const [mentionPopoverStyle, setMentionPopoverStyle] = useState<MentionPopoverStyle | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const [targetFilter, setTargetFilter] = useState('')
  const [targetPopoverStyle, setTargetPopoverStyle] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  const selectedCount = draft.targetStationIds.length
  const filteredStations = useMemo(() => {
    const keyword = targetFilter.trim().toLowerCase()
    if (!keyword) {
      return stations
    }
    return stations.filter((station) => {
      const searchText = `${station.name} ${station.id} ${station.role}`.toLowerCase()
      return searchText.includes(keyword)
    })
  }, [stations, targetFilter])

  useEffect(() => {
    if (!targetPickerOpen) {
      return
    }
    const updatePosition = () => {
      const trigger = targetTriggerRef.current
      if (!trigger) {
        return
      }
      const rect = trigger.getBoundingClientRect()
      const viewportPadding = 16
      const minWidth = 320
      const viewportWidth = window.innerWidth
      const width = Math.min(
        Math.max(rect.width, minWidth),
        Math.max(minWidth, viewportWidth - viewportPadding * 2),
      )
      const left = Math.min(
        Math.max(rect.left, viewportPadding),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding),
      )
      setTargetPopoverStyle({
        top: rect.bottom + 6,
        left,
        width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [targetPickerOpen])

  useEffect(() => {
    if (!targetPickerOpen) {
      return
    }
    const onDocumentPointerDown = (event: MouseEvent) => {
      const trigger = targetTriggerRef.current
      const popover = document.querySelector('.task-center-target-popover-portal')
      const target = event.target as Node
      if (trigger?.contains(target)) {
        return
      }
      if (popover?.contains(target)) {
        return
      }
      setTargetPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocumentPointerDown)
    return () => {
      document.removeEventListener('mousedown', onDocumentPointerDown)
    }
  }, [targetPickerOpen])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    const syncHeight = () => {
      textarea.style.height = 'auto'
      textarea.style.height = toRem(textarea.scrollHeight)
    }
    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [draft.markdown])

  useEffect(() => {
    if (!mentionRange) {
      setMentionPopoverStyle(null)
      return
    }

    const updateMentionPopoverPosition = () => {
      const textarea = textareaRef.current
      if (!textarea) {
        return
      }

      const viewportPadding = 16
      const preferredWidth = Math.min(textarea.getBoundingClientRect().width, 420)
      const minWidth = 260
      const { top, left, lineHeight, textareaRect } = resolveTextareaCaretViewportPosition(
        textarea,
        mentionRange.end,
      )
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const width = Math.min(
        Math.max(minWidth, preferredWidth),
        Math.max(minWidth, viewportWidth - viewportPadding * 2),
      )
      const anchoredLeft = Math.min(
        Math.max(viewportPadding, left),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding),
      )
      const desiredTop = top + lineHeight + 10
      const spaceBelow = viewportHeight - desiredTop - viewportPadding
      const spaceAbove = top - viewportPadding - 10
      const placement = spaceBelow >= 180 || spaceBelow >= spaceAbove ? 'bottom' : 'top'
      const maxHeight = Math.max(120, Math.min(240, placement === 'bottom' ? spaceBelow : spaceAbove))
      const anchoredTop =
        placement === 'bottom'
          ? Math.min(desiredTop, viewportHeight - maxHeight - viewportPadding)
          : Math.max(viewportPadding, top - maxHeight - 10)

      setMentionPopoverStyle({
        top: Math.max(viewportPadding, anchoredTop),
        left: Math.max(viewportPadding, anchoredLeft),
        width: Math.max(minWidth, Math.min(width, textareaRect.width)),
        maxHeight,
        placement,
      })
    }

    updateMentionPopoverPosition()
    window.addEventListener('resize', updateMentionPopoverPosition)
    window.addEventListener('scroll', updateMentionPopoverPosition, true)
    return () => {
      window.removeEventListener('resize', updateMentionPopoverPosition)
      window.removeEventListener('scroll', updateMentionPopoverPosition, true)
    }
  }, [mentionRange, draft.markdown])

  const syncMentionState = (value: string, cursor: number) => {
    const nextRange = resolveMentionRange(value, cursor)
    const nextQuery = nextRange?.query ?? ''
    if (nextQuery !== mentionQueryRef.current) {
      mentionQueryRef.current = nextQuery
      if (activeMentionIndex !== 0) {
        setActiveMentionIndex(0)
      }
    }
    setMentionRange(nextRange)
    if (!nextRange) {
      onClearMentionSearch()
      return
    }
    onSearchMentionFiles(nextRange.query)
  }

  const applyMentionCandidate = (candidate: TaskMentionFileCandidate) => {
    if (!mentionRange) {
      return
    }
    const inserted = `@${candidate.path}`
    const nextValue =
      draft.markdown.slice(0, mentionRange.start) +
      inserted +
      ' ' +
      draft.markdown.slice(mentionRange.end)
    const cursor = mentionRange.start + inserted.length + 1
    onDraftChange({ markdown: nextValue })
    mentionQueryRef.current = ''
    setMentionRange(null)
    setActiveMentionIndex(0)
    onClearMentionSearch()
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) {
        return
      }
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <aside
      className={`panel task-center-pane ${variant === 'overlay' ? 'task-center-pane--overlay' : ''} ${compact ? 'task-center-pane--compact' : ''}`}
    >
      {showHeader ? (
        <header className="task-center-header">
          <h2>{title ?? t(locale, 'taskCenter.title')}</h2>
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}

      <section className="task-center-target-picker">
        <div className="task-center-targets-header">
          <span>{t(locale, 'taskCenter.targetAgents')}</span>
          {selectedCount > 0 ? <strong>{selectedCount}</strong> : null}
        </div>
        <button
          ref={targetTriggerRef}
          type="button"
          className={`task-center-target-tag-trigger ${targetPickerOpen ? 'open' : ''}`}
          onClick={() => {
            setTargetPickerOpen((prev) => !prev)
          }}
        >
          <div className="task-center-target-tag-wrap">
            {draft.targetStationIds.length === 0 ? (
              <span className="task-center-target-placeholder">
                {t(locale, 'taskCenter.targetPlaceholder')}
              </span>
            ) : (
              draft.targetStationIds.map((stationId) => {
                const station = stations.find((item) => item.id === stationId)
                const label = station?.name ?? stationId
                return (
                  <span key={stationId} className="task-center-target-tag-chip">
                    <em>{label}</em>
                    <i
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onDraftChange({
                          targetStationIds: draft.targetStationIds.filter((id) => id !== stationId),
                        })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          onDraftChange({
                            targetStationIds: draft.targetStationIds.filter((id) => id !== stationId),
                          })
                        }
                      }}
                    >
                      ×
                    </i>
                  </span>
                )
              })
            )}
          </div>
          <strong>▾</strong>
        </button>
      </section>
      {targetPickerOpen && targetPopoverStyle && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="task-center-target-popover-portal"
              style={
                {
                  '--task-center-target-popover-top': toRem(targetPopoverStyle.top),
                  '--task-center-target-popover-left': toRem(targetPopoverStyle.left),
                  '--task-center-target-popover-width': toRem(targetPopoverStyle.width),
                } as CSSProperties
              }
            >
              <div className="task-center-target-popover-tools">
                <input
                  type="search"
                  value={targetFilter}
                  placeholder={t(locale, 'taskCenter.agentFilterPlaceholder')}
                  onChange={(event) => {
                    setTargetFilter(event.target.value)
                  }}
                />
                <div className="task-center-target-actions">
                  <button
                    type="button"
                    onClick={() =>
                      onDraftChange({
                        targetStationIds: stations.map((station) => station.id),
                      })
                    }
                    disabled={stations.length === 0}
                  >
                    {t(locale, 'taskCenter.selectAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onDraftChange({
                        targetStationIds: [],
                      })
                    }
                    disabled={draft.targetStationIds.length === 0}
                  >
                    {t(locale, 'taskCenter.clearSelection')}
                  </button>
                </div>
              </div>
              {filteredStations.length === 0 ? (
                <p className="task-center-empty">{t(locale, 'taskCenter.noAgents')}</p>
              ) : (
                <ul className="task-center-target-list">
                  {filteredStations.map((station) => {
                    const checked = draft.targetStationIds.includes(station.id)
                    return (
                      <li key={station.id}>
                        <button
                          type="button"
                          className={checked ? 'active' : ''}
                          onClick={() => {
                            onDraftChange({
                              targetStationIds: toggleTaskTarget(
                                draft.targetStationIds,
                                station.id,
                                !checked,
                              ),
                            })
                          }}
                        >
                          <span>{station.name}</span>
                          <i>{checked ? '✓' : ''}</i>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}

      <section className="task-center-editor">
        <header className="task-center-editor-header">
          <strong>{t(locale, 'taskCenter.editorLabel')}</strong>
        </header>

        <div className="task-center-editor-input-wrap">
          <textarea
            ref={textareaRef}
            value={draft.markdown}
            placeholder={t(locale, 'taskCenter.markdownPlaceholder')}
            onFocus={() => {
              onEditorFocusChange?.(true)
            }}
            onBlur={() => {
              onEditorFocusChange?.(false)
            }}
            onChange={(event) => {
              const value = event.target.value
              const cursor = event.target.selectionStart ?? value.length
              onDraftChange({ markdown: value })
              syncMentionState(value, cursor)
            }}
            onClick={(event) => {
              const cursor = event.currentTarget.selectionStart ?? event.currentTarget.value.length
              syncMentionState(event.currentTarget.value, cursor)
            }}
            onKeyUp={(event) => {
              const cursor = event.currentTarget.selectionStart ?? event.currentTarget.value.length
              syncMentionState(event.currentTarget.value, cursor)
            }}
            onKeyDown={(event) => {
              const mentionVisible = Boolean(mentionRange)
              if (!mentionVisible) {
                return
              }
              const maxIndex = mentionCandidates.length - 1
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveMentionIndex((prev) => (prev >= maxIndex ? 0 : prev + 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveMentionIndex((prev) => (prev <= 0 ? Math.max(0, maxIndex) : prev - 1))
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && mentionCandidates.length > 0) {
                event.preventDefault()
                applyMentionCandidate(mentionCandidates[activeMentionIndex] ?? mentionCandidates[0])
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setMentionRange(null)
                onClearMentionSearch()
              }
            }}
          />

        </div>

        <div className="task-center-editor-footer">
          {sendShortcutHint ? (
            <span className="task-center-send-shortcut-hint">{sendShortcutHint}</span>
          ) : null}
          <button
            type="button"
            className="task-center-inline-send primary"
            onClick={onSendTask}
            disabled={sending || stations.length === 0}
          >
            <AppIcon name="sparkles" className="vb-icon" />
            <span>
              {sending ? t(locale, 'taskCenter.sending') : t(locale, 'taskCenter.sendTask')}
            </span>
          </button>
        </div>
      </section>

      <section className="task-center-send-row">
        {notice ? (
          <p className={`task-center-notice ${notice.kind}`}>{notice.message}</p>
        ) : null}
      </section>
      {mentionRange && mentionPopoverStyle && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`task-center-mention-popover task-center-mention-popover--${mentionPopoverStyle.placement}`}
              role="listbox"
              style={
                {
                  '--task-center-mention-top': toRem(mentionPopoverStyle.top),
                  '--task-center-mention-left': toRem(mentionPopoverStyle.left),
                  '--task-center-mention-width': toRem(mentionPopoverStyle.width),
                  '--task-center-mention-max-height': toRem(mentionPopoverStyle.maxHeight),
                } as CSSProperties
              }
            >
              {mentionLoading ? (
                <p className="task-center-mention-empty">{t(locale, 'taskCenter.mentionSearching')}</p>
              ) : mentionError ? (
                <p className="task-center-mention-empty task-center-mention-error">{mentionError}</p>
              ) : mentionCandidates.length === 0 ? (
                <p className="task-center-mention-empty">{t(locale, 'taskCenter.mentionEmpty')}</p>
              ) : (
                <ul>
                  {mentionCandidates.map((candidate, index) => (
                    <li key={candidate.path}>
                      <button
                        type="button"
                        className={index === activeMentionIndex ? 'active' : ''}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          applyMentionCandidate(candidate)
                        }}
                      >
                        <strong>{candidate.name}</strong>
                        <span>{candidate.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </aside>
  )
}

export const TaskCenterPane = memo(TaskCenterPaneView)
