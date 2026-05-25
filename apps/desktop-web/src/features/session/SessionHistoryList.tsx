import { memo, useCallback } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { SessionCard } from '@shell/integration/desktop-api'
import type { SessionRelaunchRequest } from './session-relaunch'
import { providerIcon, providerLabel, lifecycleChipClass, formatRelativeTime, hasStats } from './session-history-model'
import './SessionHistoryList.scss'

export interface SessionHistoryListProps {
  locale: Locale
  cards: SessionCard[]
  loading: boolean
  error?: string | null
  onDiscover: () => void
  onRelaunch?: (request: SessionRelaunchRequest) => void
}

export const SessionHistoryList = memo(function SessionHistoryList({
  locale,
  cards,
  loading,
  error = null,
  onDiscover,
  onRelaunch,
}: SessionHistoryListProps) {
  const handleContinueLast = useCallback(() => {
    onRelaunch?.({ mode: 'continueLast' })
  }, [onRelaunch])

  const handleForkLast = useCallback(() => {
    onRelaunch?.({ mode: 'forkLast' })
  }, [onRelaunch])

  const quickActions = onRelaunch ? (
    <div className="session-history-quick-actions">
      <button type="button" className="session-history-quick-btn" onClick={handleContinueLast} disabled={loading}>
        <AppIcon name="rotate-ccw" className="vb-icon" aria-hidden="true" />
        <span>{t(locale, '继续上次', 'Continue last')}</span>
      </button>
      <button type="button" className="session-history-quick-btn" onClick={handleForkLast} disabled={loading}>
        <AppIcon name="git-branch" className="vb-icon" aria-hidden="true" />
        <span>{t(locale, '分叉上次', 'Fork last')}</span>
      </button>
    </div>
  ) : null

  const discoverButton = (
    <button
      type="button"
      className="session-history-discover-btn"
      onClick={onDiscover}
      disabled={loading}
    >
      <AppIcon name="refresh" className="vb-icon" aria-hidden="true" />
      <span>{t(locale, '扫描', 'Scan')}</span>
    </button>
  )

  const listHeader = (showDiscover: boolean) => (
    <div className="session-history-list-header">
      <strong>{t(locale, '历史会话', 'Session History')}</strong>
      {quickActions || showDiscover ? (
        <div className="session-history-list-header-actions">
          {quickActions}
          {showDiscover ? discoverButton : null}
        </div>
      ) : null}
    </div>
  )

  if (loading && cards.length === 0) {
    return (
      <div className="session-history-list">
        {listHeader(false)}
        <div className="session-history-list-empty">
          <AppIcon name="clock" className="vb-icon" aria-hidden="true" />
          <span>{t(locale, '扫描中…', 'Scanning…')}</span>
        </div>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="session-history-list">
        {listHeader(true)}
        <div className="session-history-list-empty">
          <AppIcon name="clock" className="vb-icon" aria-hidden="true" />
          <span>
            {error
              ? t(locale, '加载失败', 'Failed to load')
              : t(locale, '暂无历史会话', 'No session history yet')}
          </span>
          {error ? <span className="session-history-list-error-detail">{error}</span> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="session-history-list">
      {listHeader(true)}
      <div className="session-history-list-cards" role="list">
        {cards.map((card) => (
          <SessionHistoryCardItem
            key={card.gtoSessionId}
            locale={locale}
            card={card}
            onRelaunch={onRelaunch}
          />
        ))}
      </div>
    </div>
  )
})

interface SessionHistoryCardItemProps {
  locale: Locale
  card: SessionCard
  onRelaunch?: (request: SessionRelaunchRequest) => void
}

const SessionHistoryCardItem = memo(function SessionHistoryCardItem({
  locale,
  card,
  onRelaunch,
}: SessionHistoryCardItemProps) {
  const relaunchPayload = useCallback(
    (mode: SessionRelaunchRequest['mode']): SessionRelaunchRequest => ({
      mode,
      gtoSessionId: card.gtoSessionId,
      providerSessionId: card.providerSessionId ?? null,
      cwd: card.cwd,
    }),
    [card.cwd, card.gtoSessionId, card.providerSessionId],
  )

  const handleResume = useCallback(() => {
    onRelaunch?.(relaunchPayload('resume'))
  }, [onRelaunch, relaunchPayload])

  const handleFork = useCallback(() => {
    onRelaunch?.(relaunchPayload('fork'))
  }, [onRelaunch, relaunchPayload])

  return (
    <div className={['session-history-card', lifecycleChipClass(card.lifecycle)].join(' ')} role="listitem">
      <div className="session-history-card-header">
        <div className="session-history-card-provider">
          <AppIcon name={providerIcon(card.provider) as any} className="vb-icon" aria-hidden="true" />
          <span>{providerLabel(card.provider)}</span>
        </div>
        <span className={['session-history-card-lifecycle', lifecycleChipClass(card.lifecycle)].join(' ')}>
          {card.lifecycle}
        </span>
      </div>
      <div className="session-history-card-title">
        {card.title ?? t(locale, '无标题', 'Untitled')}
      </div>
      <div className="session-history-card-footer">
        <span className="session-history-card-time">{formatRelativeTime(card.lastActivityAtMs)}</span>
        {hasStats(card) ? (
          <span className="session-history-card-stats">
            {card.commitsAhead > 0 && <span>{card.commitsAhead} commit{card.commitsAhead > 1 ? 's' : ''}</span>}
            {card.filesChanged > 0 && <span>{card.filesChanged} file{card.filesChanged > 1 ? 's' : ''}</span>}
            {card.insertions > 0 && <span className="stat-ins">+{card.insertions}</span>}
            {card.deletions > 0 && <span className="stat-del">-{card.deletions}</span>}
          </span>
        ) : null}
        {card.lifecycle === 'stopped' && onRelaunch ? (
          <div className="session-history-card-actions">
            <button type="button" className="session-history-card-resume" onClick={handleResume}>
              <AppIcon name="rotate-ccw" className="vb-icon" aria-hidden="true" />
              <span>{t(locale, '恢复', 'Resume')}</span>
            </button>
            <button type="button" className="session-history-card-fork" onClick={handleFork}>
              <AppIcon name="git-branch" className="vb-icon" aria-hidden="true" />
              <span>{t(locale, '分叉', 'Fork')}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
})
