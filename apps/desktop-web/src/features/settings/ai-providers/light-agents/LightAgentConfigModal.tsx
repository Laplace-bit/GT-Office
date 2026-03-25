import type {
  AiAgentSnapshotCard,
  AiConfigSnapshot,
  CodexSnapshot,
  GeminiSnapshot,
} from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'

import { ProviderWorkspaceModal } from '../shared/ProviderWorkspaceModal'

interface BaseLightProviderConfigModalProps<TGuide extends CodexSnapshot | GeminiSnapshot> {
  workspaceId?: string | null
  locale: Locale
  agent: AiAgentSnapshotCard
  guide: TGuide
  installing?: boolean
  onInstall?: () => void
  onReload: () => void | Promise<void>
  onSnapshotUpdate?: (effective: AiConfigSnapshot) => void
  onClose: () => void
}

export function CodexConfigModal({
  workspaceId,
  locale,
  agent,
  guide,
  onReload,
  onSnapshotUpdate,
  onClose,
}: BaseLightProviderConfigModalProps<CodexSnapshot>) {
  return (
    <ProviderWorkspaceModal
      agentId="codex"
      workspaceId={workspaceId}
      locale={locale}
      agent={agent}
      guide={guide}
      onReload={async () => {
        await onReload()
      }}
      onSnapshotUpdate={onSnapshotUpdate ?? (() => {})}
      onClose={onClose}
    />
  )
}

export function GeminiConfigModal({
  workspaceId,
  locale,
  agent,
  guide,
  onReload,
  onSnapshotUpdate,
  onClose,
}: BaseLightProviderConfigModalProps<GeminiSnapshot>) {
  return (
    <ProviderWorkspaceModal
      agentId="gemini"
      workspaceId={workspaceId}
      locale={locale}
      agent={agent}
      guide={guide}
      onReload={async () => {
        await onReload()
      }}
      onSnapshotUpdate={onSnapshotUpdate ?? (() => {})}
      onClose={onClose}
    />
  )
}
