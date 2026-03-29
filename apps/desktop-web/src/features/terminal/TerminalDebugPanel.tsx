import { useEffect, useMemo, useRef, useState } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { useStationTerminalDebugRecords } from './terminal-debug-store'
import type { TerminalDebugRecord } from './terminal-debug-model'
import { parseTerminalDebugBody } from './terminal-vt-parser'
import { buildTerminalHumanLog } from './terminal-human-log'
import './TerminalDebugPanel.scss'

interface TerminalDebugPanelProps {
  locale: Locale
  stationId: string
  hidden: boolean
  onHiddenChange: (hidden: boolean) => void
  onClear: () => void
}

type TerminalDebugView = 'human' | 'parsed' | 'raw'

function formatDebugTime(locale: Locale, atMs: number): string {
  return new Date(atMs).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour12: false,
  })
}

function buildContinuousLog(locale: Locale, records: TerminalDebugRecord[]): string {
  return records
    .map((record) =>
      [
        `[${formatDebugTime(locale, record.atMs)}] [${record.lane}] [${record.kind}]${record.source ? ` [${record.source}]` : ''}`,
        record.summary,
        record.body,
      ].join('\n'),
    )
    .join('\n\n')
}

function buildParsedLog(locale: Locale, records: TerminalDebugRecord[]): string {
  return records
    .map((record) =>
      [
        `[${formatDebugTime(locale, record.atMs)}] [${record.lane}] [${record.kind}]${record.source ? ` [${record.source}]` : ''}`,
        parseTerminalDebugBody(record.body),
      ].join('\n'),
    )
    .join('\n\n')
}

export function TerminalDebugPanel({
  locale,
  stationId,
  hidden,
  onHiddenChange,
  onClear,
}: TerminalDebugPanelProps) {
  const records = useStationTerminalDebugRecords(stationId)
  const [collapsed, setCollapsed] = useState(false)
  const [view, setView] = useState<TerminalDebugView>('human')
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (collapsed || hidden) {
      return
    }
    const element = bodyRef.current
    if (!element) {
      return
    }
    element.scrollTop = element.scrollHeight
  }, [collapsed, hidden, records])

  const title = useMemo(
    () => t(locale, '终端调试窗口', 'Terminal Debug'),
    [locale],
  )
  const humanLog = useMemo(() => buildTerminalHumanLog(locale, records), [locale, records])
  const continuousLog = useMemo(() => buildContinuousLog(locale, records), [locale, records])
  const parsedLog = useMemo(() => buildParsedLog(locale, records), [locale, records])
  const activeLog = view === 'human' ? humanLog : view === 'parsed' ? parsedLog : continuousLog
  const activeTitle =
    view === 'human'
      ? t(locale, '人类视图', 'Human')
      : view === 'parsed'
        ? t(locale, '官方解析', 'Parsed')
        : t(locale, '原始输出', 'Raw')

  if (hidden) {
    return (
      <button
        type="button"
        className="terminal-debug-launcher"
        onClick={() => onHiddenChange(false)}
        aria-label={title}
      >
        <span>{title}</span>
        <strong>{records.length}</strong>
      </button>
    )
  }

  return (
    <section className={['terminal-debug-panel', collapsed ? 'collapsed' : ''].join(' ')}>
      <header className="terminal-debug-panel-header">
        <div className="terminal-debug-panel-title">
          <strong>{title}</strong>
          <span>{t(locale, '{count} 条记录', '{count} records', { count: records.length })}</span>
        </div>
        <div className="terminal-debug-panel-actions">
          <button type="button" onClick={onClear}>
            {t(locale, '清空', 'Clear')}
          </button>
          <button type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? t(locale, '展开', 'Expand') : t(locale, '收起', 'Collapse')}
          </button>
          <button type="button" onClick={() => onHiddenChange(true)}>
            {t(locale, '隐藏', 'Hide')}
          </button>
        </div>
      </header>
      {collapsed ? null : (
        <div ref={bodyRef} className="terminal-debug-panel-body">
          {records.length === 0 ? (
            <div className="terminal-debug-panel-empty">
              {t(locale, '终端实时事件会显示在这里。', 'Live terminal events will appear here.')}
            </div>
          ) : (
            <>
              <div className="terminal-debug-panel-tabs" role="tablist" aria-label={title}>
                <button
                  type="button"
                  className={view === 'human' ? 'active' : ''}
                  onClick={() => setView('human')}
                >
                  {t(locale, '人类视图', 'Human')}
                </button>
                <button
                  type="button"
                  className={view === 'parsed' ? 'active' : ''}
                  onClick={() => setView('parsed')}
                >
                  {t(locale, '官方解析', 'Parsed')}
                </button>
                <button
                  type="button"
                  className={view === 'raw' ? 'active' : ''}
                  onClick={() => setView('raw')}
                >
                  {t(locale, '原始输出', 'Raw')}
                </button>
              </div>
              <section className="terminal-debug-panel-section">
                <header>{activeTitle}</header>
                <pre className={['terminal-debug-panel-log', view].join(' ')}>
                  {activeLog || t(locale, '当前没有可展示的格式化内容。', 'No formatted content for the current view yet.')}
                </pre>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  )
}
