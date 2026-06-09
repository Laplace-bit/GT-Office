import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { SessionCard } from '@shell/integration/desktop-api'
import type { SessionRelaunchRequest } from './session-relaunch'
import { providerIcon, providerLabel, formatRelativeTime, hasStats } from './session-history-model'
import './SessionHistoryList.scss'

const SESSION_HISTORY_TYPEAHEAD_RESET_MS = 700

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

  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setActiveIndex((current) => clampSessionHistoryIndex(current, cards.length))
  }, [cards.length])

  useEffect(() => {
    return () => {
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current)
      }
    }
  }, [])

  const cardLabels = useMemo(
    () => cards.map((card) => buildSessionHistorySearchLabel(card)),
    [cards],
  )
  const activeCard = cards[activeIndex] ?? null

  const findSessionHistoryItem = useCallback((index: number) => {
    const card = cards[index]
    if (!card) {
      return null
    }
    const listElement = listRef.current
    if (!listElement) {
      return null
    }
    return listElement.querySelector<HTMLElement>(`[data-session-history-index="${index}"]`)
  }, [cards])

  const revealSessionHistoryItem = useCallback((index: number, focus: boolean) => {
    const itemElement = findSessionHistoryItem(index)
    if (!itemElement) {
      return
    }
    if (focus) {
      itemElement.focus({ preventScroll: true })
    }
    itemElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [findSessionHistoryItem])

  const setActiveSessionIndex = useCallback((nextIndex: number, focus = false) => {
    setActiveIndex((current) => {
      const clamped = clampSessionHistoryIndex(nextIndex, cards.length)
      if (clamped === current) {
        if (focus) {
          window.requestAnimationFrame(() => revealSessionHistoryItem(clamped, true))
        }
        return current
      }
      window.requestAnimationFrame(() => revealSessionHistoryItem(clamped, focus))
      return clamped
    })
  }, [cards.length, revealSessionHistoryItem])

  const relaunchSession = useCallback(
    (card: SessionCard | null, mode: SessionRelaunchRequest['mode']) => {
      if (!card) {
        return
      }
      onRelaunch?.(buildSessionRelaunchPayload(card, mode))
    },
    [onRelaunch],
  )

  const handleListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (cards.length === 0) {
      return
    }

    if (event.nativeEvent.isComposing) {
      return
    }

    if (isSessionHistoryControlTarget(event.target)) {
      return
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault()
        setActiveSessionIndex(activeIndex + 1, true)
        return
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault()
        setActiveSessionIndex(activeIndex - 1, true)
        return
      case 'Home':
        event.preventDefault()
        setActiveSessionIndex(0, true)
        return
      case 'End':
        event.preventDefault()
        setActiveSessionIndex(cards.length - 1, true)
        return
      case 'Enter':
        if (!onRelaunch) {
          return
        }
        event.preventDefault()
        relaunchSession(activeCard, event.shiftKey ? 'fork' : 'resume')
        return
      case ' ':
        if (!onRelaunch) {
          return
        }
        event.preventDefault()
        relaunchSession(activeCard, 'resume')
        return
      default:
        break
    }

    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) {
      return
    }

    const nextQuery = `${typeaheadRef.current}${event.key}`.toLocaleLowerCase()
    typeaheadRef.current = nextQuery
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current)
    }
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = ''
      typeaheadTimerRef.current = null
    }, SESSION_HISTORY_TYPEAHEAD_RESET_MS)

    const matchIndex = findNextSessionHistoryMatch(cardLabels, nextQuery, activeIndex)
    if (matchIndex >= 0) {
      event.preventDefault()
      setActiveSessionIndex(matchIndex, true)
    }
  }, [
    activeCard,
    activeIndex,
    cardLabels,
    cards.length,
    onRelaunch,
    relaunchSession,
    setActiveSessionIndex,
  ])

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
      <div
        ref={listRef}
        className="session-history-list-cards"
        role="list"
        aria-label={t(locale, '历史会话', 'Session History')}
        onKeyDown={handleListKeyDown}
      >
        {cards.map((card, index) => (
          <SessionHistoryCardItem
            key={card.gtoSessionId}
            locale={locale}
            card={card}
            active={index === activeIndex}
            index={index}
            onActivate={() => setActiveSessionIndex(index)}
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
  active: boolean
  index: number
  onActivate: () => void
  onRelaunch?: (request: SessionRelaunchRequest) => void
}

const SessionHistoryCardItem = memo(function SessionHistoryCardItem({
  locale,
  card,
  active,
  index,
  onActivate,
  onRelaunch,
}: SessionHistoryCardItemProps) {
  const handleResume = useCallback(() => {
    onRelaunch?.(buildSessionRelaunchPayload(card, 'resume'))
  }, [card, onRelaunch])

  const handleFork = useCallback(() => {
    onRelaunch?.(buildSessionRelaunchPayload(card, 'fork'))
  }, [card, onRelaunch])

  return (
    <div
      className={['session-history-card', active ? 'is-active' : ''].filter(Boolean).join(' ')}
      role="listitem"
      tabIndex={active ? 0 : -1}
      aria-current={active ? 'true' : undefined}
      aria-label={buildSessionHistoryItemAriaLabel(locale, card)}
      aria-keyshortcuts={onRelaunch ? 'Enter Shift+Enter Space' : undefined}
      data-session-history-id={card.gtoSessionId}
      data-session-history-index={index}
      onMouseEnter={onActivate}
      onFocus={onActivate}
    >
      <div className="session-history-card-header">
        <div className="session-history-card-provider">
          <AppIcon name={providerIcon(card.provider) as any} className="vb-icon" aria-hidden="true" />
          <span>{providerLabel(card.provider)}</span>
        </div>
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
        {onRelaunch ? (
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

function clampSessionHistoryIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

function buildSessionRelaunchPayload(
  card: SessionCard,
  mode: SessionRelaunchRequest['mode'],
): SessionRelaunchRequest {
  return {
    mode,
    gtoSessionId: card.gtoSessionId,
    providerSessionId: card.providerSessionId ?? null,
    cwd: card.cwd,
  }
}

function buildSessionHistorySearchLabel(card: SessionCard): string {
  return [
    card.title,
    providerLabel(card.provider),
    card.cwd,
    card.providerSessionId,
    card.gtoSessionId,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLocaleLowerCase()
}

function buildSessionHistoryItemAriaLabel(locale: Locale, card: SessionCard): string {
  const title = card.title ?? t(locale, '无标题', 'Untitled')
  const provider = providerLabel(card.provider)
  const time = formatRelativeTime(card.lastActivityAtMs)
  const stats = hasStats(card)
    ? [
        card.commitsAhead > 0
          ? t(locale, '{count} 个提交领先', '{count} commits ahead', { count: card.commitsAhead })
          : null,
        card.filesChanged > 0
          ? t(locale, '{count} 个文件变更', '{count} files changed', { count: card.filesChanged })
          : null,
        card.insertions > 0 ? `+${card.insertions}` : null,
        card.deletions > 0 ? `-${card.deletions}` : null,
      ].filter((part): part is string => Boolean(part))
    : []

  return [title, provider, time, ...stats].join(', ')
}

function findNextSessionHistoryMatch(labels: string[], query: string, activeIndex: number): number {
  if (!query || labels.length === 0) {
    return -1
  }
  for (let offset = 1; offset <= labels.length; offset += 1) {
    const index = (activeIndex + offset) % labels.length
    if (labels[index]?.includes(query)) {
      return index
    }
  }
  return -1
}

function isSessionHistoryControlTarget(target: EventTarget): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button, input, textarea, select, a'))
}
