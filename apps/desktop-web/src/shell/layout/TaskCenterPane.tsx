import { memo } from 'react'
import type { AgentStation } from './model'
import type {
  TaskAttachment,
  TaskCenterNotice,
  TaskDispatchRecord,
  TaskDraftState,
  TaskMarkdownSnippet,
} from '@features/task-center'
import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'

interface TaskCenterPaneProps {
  locale: Locale
  stations: AgentStation[]
  selectedFilePath: string | null
  draft: TaskDraftState
  attachments: TaskAttachment[]
  dispatchHistory: TaskDispatchRecord[]
  sending: boolean
  retryingTaskId: string | null
  draftSavedAtMs: number | null
  notice: TaskCenterNotice | null
  onDraftChange: (patch: Partial<TaskDraftState>) => void
  onAddAttachmentFromInput: () => void
  onAddAttachmentPath: (path: string) => void
  onRemoveAttachment: (attachmentId: string) => void
  onInsertAttachmentReference: (attachmentId: string) => void
  onInsertSnippet: (snippet: TaskMarkdownSnippet) => void
  onSendTask: () => void
  onRetryDispatchTask: (taskId: string) => void
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

function formatTimestamp(value: number): string {
  const date = new Date(value)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function TaskCenterPaneView({
  locale,
  stations,
  selectedFilePath,
  draft,
  attachments,
  dispatchHistory,
  sending,
  retryingTaskId,
  draftSavedAtMs,
  notice,
  onDraftChange,
  onAddAttachmentFromInput,
  onAddAttachmentPath,
  onRemoveAttachment,
  onInsertAttachmentReference,
  onInsertSnippet,
  onSendTask,
  onRetryDispatchTask,
}: TaskCenterPaneProps) {
  return (
    <aside className="panel task-center-pane">
      <header className="task-center-header">
        <h2>{t(locale, 'taskCenter.title')}</h2>
        <p>{t(locale, 'taskCenter.subtitle')}</p>
      </header>

      <label className="task-center-field">
        <span>{t(locale, 'taskCenter.targetAgent')}</span>
        <select
          value={draft.targetStationId}
          onChange={(event) => onDraftChange({ targetStationId: event.target.value })}
        >
          {stations.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name} ({station.id})
            </option>
          ))}
        </select>
      </label>

      <label className="task-center-field">
        <span>{t(locale, 'taskCenter.taskTitle')}</span>
        <input
          type="text"
          value={draft.title}
          placeholder={t(locale, 'taskCenter.taskTitlePlaceholder')}
          onChange={(event) => onDraftChange({ title: event.target.value })}
        />
      </label>

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

      <label className="task-center-field task-center-markdown-field">
        <span>{t(locale, 'taskCenter.markdown')}</span>
        <textarea
          value={draft.markdown}
          placeholder={t(locale, 'taskCenter.markdownPlaceholder')}
          onChange={(event) => onDraftChange({ markdown: event.target.value })}
        />
      </label>

      <section className="task-center-attachments">
        <div className="task-center-attachments-header">
          <strong>{t(locale, 'taskCenter.attachments')}</strong>
          <span>{attachments.length}</span>
        </div>
        <div className="task-center-attachments-input-row">
          <input
            type="text"
            value={draft.attachmentInput}
            placeholder={t(locale, 'taskCenter.attachmentInputPlaceholder')}
            onChange={(event) => onDraftChange({ attachmentInput: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onAddAttachmentFromInput()
              }
            }}
          />
          <button type="button" onClick={onAddAttachmentFromInput}>
            {t(locale, 'taskCenter.addAttachment')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedFilePath) {
                return
              }
              onAddAttachmentPath(selectedFilePath)
            }}
            disabled={!selectedFilePath}
          >
            {t(locale, 'taskCenter.addSelectedFile')}
          </button>
        </div>
        {attachments.length === 0 ? (
          <p className="task-center-empty">{t(locale, 'taskCenter.noAttachment')}</p>
        ) : (
          <ul className="task-center-attachment-list">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <span>{attachment.name}</span>
                <code>{attachment.path}</code>
                <em>{attachment.category}</em>
                <button type="button" onClick={() => onInsertAttachmentReference(attachment.id)}>
                  {t(locale, 'taskCenter.insertReference')}
                </button>
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)}>
                  {t(locale, 'taskCenter.removeAttachment')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="task-center-send-row">
        <button type="button" onClick={onSendTask} disabled={sending || stations.length === 0}>
          {sending ? t(locale, 'taskCenter.sending') : t(locale, 'taskCenter.sendTask')}
        </button>
        {draftSavedAtMs ? (
          <p className="task-center-draft-saved">
            {t(locale, 'taskCenter.draftSavedAt', { time: formatTimestamp(draftSavedAtMs) })}
          </p>
        ) : null}
        {notice ? (
          <p className={`task-center-notice ${notice.kind}`}>{notice.message}</p>
        ) : null}
      </section>

      <section className="task-center-history">
        <h3>{t(locale, 'taskCenter.history')}</h3>
        {dispatchHistory.length === 0 ? (
          <p className="task-center-empty">{t(locale, 'taskCenter.historyEmpty')}</p>
        ) : (
          <ul>
            {dispatchHistory.map((record) => (
              <li key={record.taskId}>
                <div className="task-center-history-title-row">
                  <strong>{record.title}</strong>
                  <span className={`task-center-status ${record.status}`}>
                    {statusLabel(locale, record.status)}
                  </span>
                </div>
                <p>
                  {record.taskId} · {record.targetStationName} · {formatTimestamp(record.createdAtMs)}
                </p>
                <p>
                  {t(locale, 'taskCenter.historyAttachments', { count: record.attachmentCount })} ·{' '}
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
                {record.detail ? <p className="task-center-history-detail">{record.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}

export const TaskCenterPane = memo(TaskCenterPaneView)
