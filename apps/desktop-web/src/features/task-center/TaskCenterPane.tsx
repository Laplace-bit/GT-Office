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
  showHeader?: boolean
  title?: string
  description?: string | null
  sendShortcutHint?: string | null
}

interface MentionRange {
  start: number
  end: number
  query: string
}

function formatTimestamp(value: number): string {
  const date = new Date(value)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}:${minute}:${second}`
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

function TaskCenterPaneView({
  locale,
  stations,
  draft,
  sending,
  draftSavedAtMs,
  notice,
  mentionCandidates,
  mentionLoading,
  mentionError,
  onDraftChange,
  onInsertSnippet,
  onSendTask,
  onSearchMentionFiles,
  onClearMentionSearch,
  variant = 'pane',
  showHeader = true,
  title,
  description = null,
  sendShortcutHint = null,
}: TaskCenterPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const targetTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mentionQueryRef = useRef('')
  const [mentionRange, setMentionRange] = useState<MentionRange | null>(null)
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
    <aside className={`panel task-center-pane ${variant === 'overlay' ? 'task-center-pane--overlay' : ''}`}>
      {showHeader ? (
        <header className="task-center-header">
          <h2>{title ?? t(locale, 'taskCenter.title')}</h2>
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}

      <section className="task-center-target-picker">
        <div className="task-center-targets-header">
          <span>{t(locale, 'taskCenter.targetAgents')}</span>
          <strong>{selectedCount}</strong>
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

        <section className="task-center-markdown-toolbar">
          <button
            type="button"
            className="task-center-toolbar-btn"
            onClick={() => onInsertSnippet('heading')}
          >
            {t(locale, 'taskCenter.template.heading')}
          </button>
          <button
            type="button"
            className="task-center-toolbar-btn"
            onClick={() => onInsertSnippet('code')}
          >
            {t(locale, 'taskCenter.template.code')}
          </button>
          <button
            type="button"
            className="task-center-toolbar-btn"
            onClick={() => onInsertSnippet('checklist')}
          >
            {t(locale, 'taskCenter.template.checklist')}
          </button>
        </section>

        <div className="task-center-editor-input-wrap">
          <textarea
            ref={textareaRef}
            value={draft.markdown}
            placeholder={t(locale, 'taskCenter.markdownPlaceholder')}
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

          {mentionRange ? (
            <div className="task-center-mention-popover" role="listbox">
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
            </div>
          ) : null}
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
        {draftSavedAtMs ? (
          <p className="task-center-draft-saved">
            {t(locale, 'taskCenter.draftSavedAt', {
              time: formatTimestamp(draftSavedAtMs),
            })}
          </p>
        ) : null}
        {notice ? (
          <p className={`task-center-notice ${notice.kind}`}>{notice.message}</p>
        ) : null}
      </section>
    </aside>
  )
}

export const TaskCenterPane = memo(TaskCenterPaneView)
