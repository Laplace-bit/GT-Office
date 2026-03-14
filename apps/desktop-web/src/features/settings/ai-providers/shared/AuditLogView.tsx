import { useEffect, useState } from 'react'
import { desktopApi, type AiConfigAgent } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import './AuditLogView.scss'

interface AuditLogViewProps {
  workspaceId: string
  agent: AiConfigAgent
  locale: Locale
}

function formatTimestamp(locale: Locale, tsMs: number): string {
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(tsMs)
}

export function AuditLogView({ workspaceId, agent, locale }: AuditLogViewProps) {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const data = await desktopApi.aiConfigListAuditLogs(workspaceId, agent)
      setLogs(data)
    } catch (err) {
      console.error('Failed to fetch audit logs', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, agent])

  if (loading) {
    return <div className="audit-log-loading">{t(locale, '加载中...', 'Loading...')}</div>
  }

  if (logs.length === 0) {
    return (
      <div className="audit-log-empty">
        <div className="empty-icon">󱈚</div>
        <div className="empty-text">
          {t(locale, '暂无配置变更记录', 'No configuration change records')}
        </div>
      </div>
    )
  }

  return (
    <div className="audit-log-view">
      <div className="audit-timeline">
        {logs.map((log) => (
          <div key={log.auditId} className="audit-item">
            <div className="audit-meta">
              <span className="audit-date">
                {formatTimestamp(locale, log.createdAtMs)}
              </span>
              <span className="audit-user">{log.confirmedBy}</span>
            </div>
            <div className="audit-content">
              <div className="audit-summary">
                <span className="audit-mode">{log.mode}</span>
                {log.providerId && <span className="audit-provider">{log.providerId}</span>}
              </div>
              <div className="audit-details">
                <div className="detail-label">{t(locale, '变更字段:', 'Changes:')}</div>
                <div className="detail-tags">
                  {JSON.parse(log.changedKeysJson).map((key: string) => (
                    <span key={key} className="detail-tag">
                      {key.split('.').pop()}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="audit-refresh-button" onClick={() => void fetchLogs()}>
        {t(locale, '刷新', 'Refresh')}
      </button>
    </div>
  )
}
