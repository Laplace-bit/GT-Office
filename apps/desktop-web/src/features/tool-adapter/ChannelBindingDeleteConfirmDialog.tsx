import { createPortal } from 'react-dom'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import './ChannelBindingDeleteConfirmDialog.scss'

export type ChannelBindingDeleteConfirmKind = 'route' | 'connection'

interface ChannelBindingDeleteConfirmDialogProps {
  locale: Locale
  kind: ChannelBindingDeleteConfirmKind
  title: string
  description: string
  detail?: string | null
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ChannelBindingDeleteConfirmDialog({
  locale,
  kind,
  title,
  description,
  detail,
  loading = false,
  onCancel,
  onConfirm,
}: ChannelBindingDeleteConfirmDialogProps) {
  return createPortal(
    <div
      className="channel-binding-delete-confirm-overlay"
      onClick={loading ? undefined : onCancel}
      role="presentation"
    >
      <div
        className="channel-binding-delete-confirm-dialog"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="channel-binding-delete-confirm-title"
      >
        <div className={`channel-binding-delete-confirm-icon ${kind === 'connection' ? 'is-connection' : ''}`}>
          <AppIcon name="trash" width={20} height={20} aria-hidden="true" />
        </div>
        <h4 id="channel-binding-delete-confirm-title">{title}</h4>
        <p>{description}</p>
        {detail ? <strong className="channel-binding-delete-confirm-detail">{detail}</strong> : null}
        <div className="channel-binding-delete-confirm-actions">
          <button
            type="button"
            className="channel-binding-delete-confirm-btn is-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {t(locale, '取消', 'Cancel')}
          </button>
          <button
            type="button"
            className="channel-binding-delete-confirm-btn is-danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t(locale, '删除中…', 'Deleting…') : t(locale, '确认删除', 'Delete')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
