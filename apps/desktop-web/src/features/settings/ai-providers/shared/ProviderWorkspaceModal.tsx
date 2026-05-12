import { t } from '@shell/i18n/ui-locale'

import { AiConfigOverlay } from './AiConfigOverlay'
import { ProviderWorkspaceContent } from './ProviderWorkspaceContent'
import { ProviderWorkspaceDeleteDialog } from './ProviderWorkspaceDeleteDialog'
import {
  resolveAgentDisplayName,
  type ProviderWorkspaceModalProps,
} from './provider-workspace-shared'
import { useProviderWorkspaceController } from './useProviderWorkspaceController'

import './ProviderWorkspaceModal.scss'

export function ProviderWorkspaceModal(props: ProviderWorkspaceModalProps) {
  const { locale, agent, agentId, onClose } = props
  const controller = useProviderWorkspaceController(props)

  return (
    <AiConfigOverlay
      title={resolveAgentDisplayName(locale, agent)}
      subtitle={t(locale, '模型供应商', 'Model Providers')}
      onClose={onClose}
    >
      <ProviderWorkspaceContent agentId={agentId} locale={locale} controller={controller} />
      <ProviderWorkspaceDeleteDialog
        locale={locale}
        savedProvider={controller.pendingDeleteSavedProvider}
        onCancel={() => controller.setPendingDeleteSavedProviderId(null)}
        onConfirm={(savedProviderId) => void controller.handleDeleteSavedProvider(savedProviderId)}
      />
    </AiConfigOverlay>
  )
}
