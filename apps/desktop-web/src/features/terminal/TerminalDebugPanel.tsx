import { useEffect, useMemo, useRef, useState } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { useStationTerminalDebugHumanLog } from './terminal-debug-store'
import './TerminalDebugPanel.scss'

interface TerminalDebugPanelProps {
  locale: Locale
  stationId: string
  hidden: boolean
  onHiddenChange: (hidden: boolean) => void
  onClear: () => void
}

function formatDebugTime(locale: Locale, atMs: number): string {
  return new Date(atMs).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour12: false,
  })
}

function buildHumanLog(locale: Locale, entries: Array<{ atMs: number; text: string }>): string {
  return entries
    .map((entry) => [`[${formatDebugTime(locale, entry.atMs)}] ${t(locale, '回复', 'Reply')}`, entry.text].join('\n'))
    .join('\n\n')
}

export function TerminalDebugPanel({
  locale,
  stationId,
  hidden,
  onHiddenChange,
  onClear,
}: TerminalDebugPanelProps) {
  const humanLogState = useStationTerminalDebugHumanLog(stationId)
  const [collapsed, setCollapsed] = useState(false)
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
  }, [collapsed, hidden, humanLogState])

  const title = useMemo(
    () => t(locale, '终端调试窗口', 'Terminal Debug'),
    [locale],
  )
  const humanLog = useMemo(
    () => buildHumanLog(locale, humanLogState.entries),
    [locale, humanLogState],
  )

  if (hidden) {
    return (
      <button
        type="button"
        className="terminal-debug-launcher"
        onClick={() => onHiddenChange(false)}
        aria-label={title}
      >
        <span>{title}</span>
        <strong>{humanLogState.eventCount}</strong>
      </button>
    )
  }

  return (
    <section className={['terminal-debug-panel', collapsed ? 'collapsed' : ''].join(' ')}>
      <header className="terminal-debug-panel-header">
        <div className="terminal-debug-panel-title">
          <strong>{title}</strong>
          <span>{t(locale, '{count} 条记录', '{count} records', { count: humanLogState.eventCount })}</span>
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
          {humanLogState.eventCount === 0 ? (
            <div className="terminal-debug-panel-empty">
              {t(locale, '终端实时事件会显示在这里。', 'Live terminal events will appear here.')}
            </div>
          ) : (
            <section className="terminal-debug-panel-section">
              <header>{t(locale, '人类视图', 'Human')}</header>
              <pre className="terminal-debug-panel-log human">
                {humanLog || t(locale, '当前没有可展示的格式化内容。', 'No formatted content for the current view yet.')}
              </pre>
            </section>
          )}
        </div>
      )}
    </section>
  )
}
