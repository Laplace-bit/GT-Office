import { memo, useCallback } from 'react'
import type { Locale } from '@shell/i18n/ui-locale'
import type { SessionProvider } from '@shell/integration/desktop-api'
import { SessionHistoryList } from './SessionHistoryList'
import { useSessionHistory } from './use-session-history'
import type { SessionRelaunchRequest } from './session-relaunch'

export interface StationSessionHistoryPanelProps {
  locale: Locale
  workspaceId: string
  discoverCwd: string | null
  provider: SessionProvider
  onRelaunch?: (request: SessionRelaunchRequest) => void
}

export const StationSessionHistoryPanel = memo(function StationSessionHistoryPanel({
  locale,
  workspaceId,
  discoverCwd,
  provider,
  onRelaunch,
}: StationSessionHistoryPanelProps) {
  const sessionHistory = useSessionHistory(workspaceId, {
    discoverCwd,
    provider,
  })

  const handleDiscover = useCallback(() => {
    if (discoverCwd) {
      void sessionHistory.discover(workspaceId, discoverCwd, true)
    } else {
      void sessionHistory.refresh()
    }
  }, [discoverCwd, sessionHistory, workspaceId])

  return (
    <SessionHistoryList
      locale={locale}
      cards={sessionHistory.cards}
      loading={sessionHistory.loading}
      error={sessionHistory.error}
      onDiscover={handleDiscover}
      onRelaunch={onRelaunch}
    />
  )
})
