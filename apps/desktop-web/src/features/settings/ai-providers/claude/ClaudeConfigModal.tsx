import type {
  AiAgentSnapshotCard,
  AiConfigSnapshot,
  ClaudeSnapshot,
} from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'

import { ProviderWorkspaceModal } from '../shared/ProviderWorkspaceModal'

interface ClaudeConfigModalProps {
  locale: Locale
  workspaceId?: string | null
  agent: AiAgentSnapshotCard
  snapshot: ClaudeSnapshot
  entryMode?: 'wizard' | 'saved'
  installing?: boolean
  onInstall?: () => void
  onReload: () => Promise<void>
  onSnapshotUpdate: (effective: AiConfigSnapshot) => void
  onClose: () => void
}

export function ClaudeConfigModal({
  locale,
  agent,
  snapshot,
  onReload,
  onSnapshotUpdate,
  onClose,
}: ClaudeConfigModalProps) {
  return (
    <ProviderWorkspaceModal
      agentId="claude"
      locale={locale}
      agent={agent}
      guide={snapshot}
      onReload={onReload}
      onSnapshotUpdate={onSnapshotUpdate}
      onClose={onClose}
    />
  )
}
