import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import { localizeLabel } from './provider-workspace-presenter.js'

interface ProviderWorkspaceDeleteDialogProps {
  locale: Locale
  savedProvider: { providerName: string; savedProviderId: string } | null
  onCancel: () => void
  onConfirm: (savedProviderId: string) => void
}

export function ProviderWorkspaceDeleteDialog({
  locale,
  savedProvider,
  onCancel,
  onConfirm,
}: ProviderWorkspaceDeleteDialogProps) {
  if (!savedProvider) {
    return null
  }

  return (
    <div className="provider-workspace__confirm-overlay" onClick={onCancel}>
      <div className="provider-workspace__confirm-dialog" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={t(locale, '删除模型供应商', 'Delete provider')}>
        <div className="provider-workspace__confirm-icon">
          <AppIcon name="trash" width={20} height={20} />
        </div>
        <h4>{t(locale, '删除模型供应商', 'Delete provider')}</h4>
        <p>{t(locale, '删除后不可恢复。确认删除当前配置？', 'This action cannot be undone. Delete this saved provider?')}</p>
        <strong>{localizeLabel(locale, savedProvider.providerName)}</strong>
        <div className="provider-workspace__confirm-actions">
          <button type="button" className="provider-workspace__confirm-btn is-cancel" onClick={onCancel}>
            {t(locale, '取消', 'Cancel')}
          </button>
          <button type="button" className="provider-workspace__confirm-btn is-danger" onClick={() => onConfirm(savedProvider.savedProviderId)}>
            {t(locale, '确认删除', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
