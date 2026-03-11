import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentStation } from '@features/workspace-hub'
import {
  toggleTaskTarget,
  type TaskCenterNotice,
  type TaskDispatchRecord,
  type TaskDraftState,
  type TaskMarkdownSnippet,
} from './task-center-model'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

export interface TaskMentionFileCandidate {
  path: string
  name: string
}

interface TaskCenterPaneProps {
  locale: Locale
  stations: AgentStation[]
  draft: TaskDraftState
  dispatchHistory: TaskDispatchRecord[]
  sending: boolean
  retryingTaskId: string | null
  draftSavedAtMs: number | null
  notice: TaskCenterNotice | null
  mentionCandidates: TaskMentionFileCandidate[]
  mentionLoading: boolean
  mentionError: string | null
  externalStatus: {
    loading: boolean
    running: boolean
    doctorOk: boolean | null
    runtimeBaseUrl: string | null
    feishuWebhook: string | null
    telegramWebhook: string | null
    summary: {
      routeBindings: number
      allowlistEntries: number
      pairingPending: number
      idempotencyEntries: number
    } | null
    lastSyncAtMs: number | null
    error: string | null
    bindings?: Array<{ channel: string }>
    configuredChannels?: string[]
  }
  externalEvents: Array<{
    id: string
    tsMs: number
    kind: 'inbound' | 'routed' | 'dispatch' | 'reply' | 'error'
    primary: string
    secondary?: string
  }>
  onDraftChange: (patch: Partial<TaskDraftState>) => void
  onInsertSnippet: (snippet: TaskMarkdownSnippet) => void
  onSendTask: () => void
  onRetryDispatchTask: (taskId: string) => void
  onSearchMentionFiles: (query: string) => void
  onClearMentionSearch: () => void
  onRefreshExternalStatus: () => void
}

interface MentionRange {
  start: number
  end: number
  query: string
}

function statusLabel(locale: Locale, status: TaskDispatchRecord['status']): string {
  if (status === 'sending') {
    return t(locale, 'taskCenter.status.sending')
  }
  if (status === 'sent') {
    return t(locale, 'taskCenter.status.sent')
  }
  return t(locale, 'taskCenter.status.failed')
}

function externalEventKindLabel(
  locale: Locale,
  kind: 'inbound' | 'routed' | 'dispatch' | 'reply' | 'error',
): string {
  if (kind === 'inbound') {
    return t(locale, 'taskCenter.external.events.kind.inbound')
  }
  if (kind === 'routed') {
    return t(locale, 'taskCenter.external.events.kind.routed')
  }
  if (kind === 'dispatch') {
    return t(locale, 'taskCenter.external.events.kind.dispatch')
  }
  if (kind === 'reply') {
    return t(locale, 'taskCenter.external.events.kind.reply')
  }
  return t(locale, 'taskCenter.external.events.kind.error')
}

function externalChannelLabel(locale: Locale, channel: string): string {
  if (channel === 'telegram') {
    return 'Telegram'
  }
  if (channel === 'feishu') {
    return t(locale, '飞书', 'Feishu')
  }
  return channel
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

function TaskCenterPaneView({
  locale,
  stations,
  draft,
  dispatchHistory,
  sending,
  retryingTaskId,
  draftSavedAtMs,
  notice,
  mentionCandidates,
  mentionLoading,
  mentionError,
  externalStatus,
  externalEvents,
  onDraftChange,
  onInsertSnippet,
  onSendTask,
  onRetryDispatchTask,
  onSearchMentionFiles,
  onClearMentionSearch,
  onRefreshExternalStatus,
}: TaskCenterPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const targetTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mentionQueryRef = useRef('')
  const [mentionRange, setMentionRange] = useState<MentionRange | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [targetPickerOpen, setTargetPickerOpen] = useState(false)
  const [targetFilter, setTargetFilter] = useState('')
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true)
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
      setTargetPopoverStyle({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
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
    <aside className="panel task-center-pane">
      <header className="task-center-header">
        <h2>{t(locale, 'taskCenter.title')}</h2>
        <p>{t(locale, 'taskCenter.subtitle')}</p>
      </header>

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
              style={{
                position: 'fixed',
                top: `${targetPopoverStyle.top}px`,
                left: `${targetPopoverStyle.left}px`,
                width: `${targetPopoverStyle.width}px`,
              }}
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
                          <em>{station.id}</em>
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
          <span>{t(locale, 'taskCenter.editorHint')}</span>
        </header>

        <section className="task-center-markdown-toolbar">
          <button type="button" onClick={() => onInsertSnippet('heading')}>
            {t(locale, 'taskCenter.template.heading')}
          </button>
          <button type="button" onClick={() => onInsertSnippet('code')}>
            {t(locale, 'taskCenter.template.code')}
          </button>
          <button type="button" onClick={() => onInsertSnippet('checklist')}>
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
          <button
            type="button"
            className="task-center-inline-send"
            onClick={onSendTask}
            disabled={sending || stations.length === 0}
          >
            {sending ? t(locale, 'taskCenter.sending') : t(locale, 'taskCenter.sendTask')}
          </button>

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

      <section className="task-center-external">
        <header className="task-center-external-header">
          <div>
            <h3>{t(locale, 'taskCenter.external.title')}</h3>
            <p>{t(locale, 'taskCenter.external.subtitle')}</p>
          </div>
          <div className="task-center-external-controls">
            <span
              className={`task-center-external-runtime-pill ${
                externalStatus.running ? 'running' : 'stopped'
              }`}
            >
              {externalStatus.running
                ? t(locale, 'taskCenter.external.runtime.running')
                : t(locale, 'taskCenter.external.runtime.stopped')}
            </span>
            <button
              type="button"
              onClick={onRefreshExternalStatus}
              disabled={externalStatus.loading}
            >
              {externalStatus.loading
                ? t(locale, 'taskCenter.external.refreshing')
                : t(locale, 'taskCenter.external.refresh')}
            </button>
          </div>
        </header>
        {externalStatus.configuredChannels && externalStatus.configuredChannels.length > 0 ? (
          <div className="task-center-external-summary" style={{ justifyContent: 'flex-start', gap: '8px' }}>
            {externalStatus.configuredChannels.map((channel) => (
              <span key={channel}>
                {externalChannelLabel(locale, channel)}
              </span>
            ))}
          </div>
        ) : (
          <div className="task-center-external-summary">
            <span>{t(locale, '未配置外部通道', 'No external channels configured')}</span>
          </div>
        )}
        <div className="task-center-external-meta">
          {externalStatus.lastSyncAtMs ? (
            <span>
              {t(locale, 'taskCenter.external.lastSyncAt', {
                time: formatTimestamp(externalStatus.lastSyncAtMs),
              })}
            </span>
          ) : null}
          {externalStatus.doctorOk === false ? (
            <span className="task-center-external-doctor-warn">
              {t(locale, 'taskCenter.external.doctorWarn')}
            </span>
          ) : null}
          {externalStatus.error ? (
            <span className="task-center-external-error">{externalStatus.error}</span>
          ) : null}
        </div>
        <div className="task-center-external-events">
          <h4>{t(locale, 'taskCenter.external.events.title')}</h4>
          {externalEvents.length === 0 ? (
            <p className="task-center-empty">{t(locale, 'taskCenter.external.events.empty')}</p>
          ) : (
            <ul>
              {externalEvents.map((event) => (
                <li key={event.id}>
                  <div className="task-center-external-event-row">
                    <span className={`task-center-external-event-kind ${event.kind}`}>
                      {externalEventKindLabel(locale, event.kind)}
                    </span>
                    <span>{formatTimestamp(event.tsMs)}</span>
                  </div>
                  <p>{event.primary}</p>
                  {event.secondary ? <p>{event.secondary}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="task-center-history">
        <header 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            cursor: 'pointer', 
            userSelect: 'none' 
          }}
          onClick={() => setIsHistoryExpanded((prev) => !prev)}
        >
          <h3 style={{ margin: 0 }}>{t(locale, 'taskCenter.history')}</h3>
          <AppIcon 
            name="chevron-down" 
            style={{ 
              width: 16, 
              height: 16, 
              flex: '0 0 auto', 
              color: 'var(--vb-text-muted)',
              transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
              transform: isHistoryExpanded ? 'rotate(-180deg)' : 'rotate(0deg)'
            }} 
          />
        </header>
        <div 
          style={{ 
            display: 'grid', 
            gridTemplateRows: isHistoryExpanded ? '1fr' : '0fr', 
            transition: 'grid-template-rows 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            overflow: 'hidden'
          }}
        >
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {dispatchHistory.length === 0 ? (
              <p className="task-center-empty">{t(locale, 'taskCenter.historyEmpty')}</p>
            ) : (
              <ul>
                {dispatchHistory.map((record) => (
              <li key={`${record.batchId}:${record.taskId}`}>
                <div className="task-center-history-title-row">
                  <strong>{record.title}</strong>
                  <span className={`task-center-status ${record.status}`}>
                    {statusLabel(locale, record.status)}
                  </span>
                </div>
                <p>
                  {record.taskId} · {record.targetStationName} ·{' '}
                  {formatTimestamp(record.createdAtMs)}
                </p>
                <p>
                  <code>{record.taskFilePath}</code>
                </p>
                {record.status === 'failed' ? (
                  <div className="task-center-history-actions">
                    <button
                      type="button"
                      onClick={() => onRetryDispatchTask(record.taskId)}
                      disabled={Boolean(retryingTaskId)}
                    >
                      {retryingTaskId === record.taskId
                        ? t(locale, 'taskCenter.retrying')
                        : t(locale, 'taskCenter.retryFailed')}
                    </button>
                  </div>
                ) : null}
                {record.detail ? (
                  <p className="task-center-history-detail">{record.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
            )}
          </div>
        </div>
      </section>
    </aside>
  )
}

export const TaskCenterPane = memo(TaskCenterPaneView)
