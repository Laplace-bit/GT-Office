import { useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { desktopApi } from '@shell/integration/desktop-api'
import './WorkspaceResetSection.scss'

interface WorkspaceResetSectionProps {
  locale: Locale
  workspaceId: string | null
  onResetSuccess?: () => void
}

export function WorkspaceResetSection({ locale, workspaceId, onResetSuccess }: WorkspaceResetSectionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmationText, setConfirmationText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSubmit = Boolean(workspaceId) && confirmationText === 'RESET' && !submitting

  const handleOpen = () => {
    setError(null)
    setSuccess(null)
    setConfirmationText('')
    setConfirmOpen(true)
  }

  const handleClose = () => {
    if (submitting) {
      return
    }
    setConfirmOpen(false)
    setConfirmationText('')
    setError(null)
  }

  const handleConfirm = async () => {
    if (!workspaceId || !canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await desktopApi.workspaceResetState(workspaceId, confirmationText)
      setConfirmOpen(false)
      setConfirmationText('')
      setSuccess(t(locale, 'settingsModal.reset.success'))
      onResetSuccess?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(locale, 'settingsModal.reset.errorFallback'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="settings-reset-card" aria-labelledby="settings-reset-title">
        <div className="settings-reset-card__copy">
          <div className="settings-reset-card__eyebrow">{t(locale, 'settingsModal.reset.eyebrow')}</div>
          <h4 id="settings-reset-title">{t(locale, 'settingsModal.reset.title')}</h4>
          <p>{t(locale, 'settingsModal.reset.description')}</p>
          <p className="settings-reset-card__warning">{t(locale, 'settingsModal.reset.warning')}</p>
          {!workspaceId ? <p className="settings-reset-card__hint">{t(locale, 'settingsModal.reset.noWorkspace')}</p> : null}
          {success ? <p className="settings-reset-card__success">{success}</p> : null}
        </div>
        <button
          type="button"
          className="settings-reset-card__trigger"
          disabled={!workspaceId || submitting}
          onClick={handleOpen}
        >
          {t(locale, 'settingsModal.reset.trigger')}
        </button>
      </section>

      {confirmOpen ? (
        <div className="settings-reset-confirm-overlay" onClick={handleClose}>
          <section
            className="settings-reset-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-reset-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-reset-confirm-dialog__eyebrow">
              {t(locale, 'settingsModal.reset.confirmEyebrow')}
            </div>
            <h4 id="settings-reset-confirm-title">{t(locale, 'settingsModal.reset.confirmTitle')}</h4>
            <p>{t(locale, 'settingsModal.reset.confirmBody')}</p>
            <label className="settings-reset-confirm-dialog__field">
              <span>{t(locale, 'settingsModal.reset.confirmInputLabel')}</span>
              <input
                type="text"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                placeholder="RESET"
                autoFocus
              />
            </label>
            {error ? <p className="settings-reset-confirm-dialog__error">{error}</p> : null}
            <div className="settings-reset-confirm-dialog__actions">
              <button type="button" className="settings-reset-confirm-dialog__button is-secondary" onClick={handleClose}>
                {t(locale, 'settingsModal.reset.cancel')}
              </button>
              <button
                type="button"
                className="settings-reset-confirm-dialog__button is-danger"
                disabled={!canSubmit}
                onClick={() => {
                  void handleConfirm()
                }}
              >
                {submitting ? t(locale, 'settingsModal.reset.submitting') : t(locale, 'settingsModal.reset.confirmAction')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
