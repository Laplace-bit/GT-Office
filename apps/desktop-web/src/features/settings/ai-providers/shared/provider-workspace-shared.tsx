import type {
  AiAgentSnapshotCard,
  AiConfigSnapshot,
  ClaudeApiFormat,
  ClaudeAuthScheme,
  ClaudeModelOverrides,
  ClaudeSnapshot,
  CodexSnapshot,
  GeminiAuthMode,
  GeminiSnapshot,
} from '@shell/integration/desktop-api'
import { translateMaybeKey, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon, type AppIconName } from '@shell/ui/icons'

export type ProviderWorkspaceModalProps =
  | {
      agentId: 'claude'
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: ClaudeSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }
  | {
      agentId: 'codex'
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: CodexSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }
  | {
      agentId: 'gemini'
      locale: Locale
      agent: AiAgentSnapshotCard
      guide: GeminiSnapshot
      onReload: () => Promise<void>
      onSnapshotUpdate: (effective: AiConfigSnapshot) => void
      onClose: () => void
    }

export type ProviderWorkspaceAgentId = ProviderWorkspaceModalProps['agentId']
export type ProviderWorkspaceGuide = ProviderWorkspaceModalProps['guide']
export type EditorMode = 'create' | 'edit' | 'duplicate'
export type ViewMode = 'list' | 'editor'

export interface ProviderWorkspaceSeed {
  editorMode: EditorMode
  editingSavedProviderId: string | null
  mode: 'official' | 'preset' | 'custom'
  providerId: string
  providerName: string
  baseUrl: string
  model: string
  apiKey: string
  authScheme: ClaudeAuthScheme
  configToml: string
  authMode: GeminiAuthMode
  selectedType: string
  apiFormat: ClaudeApiFormat
  modelOverrides: ClaudeModelOverrides
}

export const CUSTOM_PROVIDER_ID = 'custom-gateway'

export function resolveSelectedType(authMode: GeminiAuthMode): string {
  return authMode === 'oauth' ? 'oauth-personal' : 'gemini-api-key'
}

export function resolveAgentDisplayName(locale: Locale, agent: AiAgentSnapshotCard): string {
  return translateMaybeKey(locale, agent.title)
}

interface ProviderIconButtonProps {
  icon: AppIconName
  label: string
  onClick?: () => void
  disabled?: boolean
  tone?: 'default' | 'danger' | 'active'
}

export function ProviderIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'default',
}: ProviderIconButtonProps) {
  return (
    <button
      type="button"
      className={`provider-workspace__icon-button is-${tone}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <AppIcon name={icon} width={16} height={16} />
      <span className="vb-sr-only">{label}</span>
    </button>
  )
}
