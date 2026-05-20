import type { ReactNode } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { WizardStepBar } from './WizardStepBar'

interface ChannelWizardFrameProps {
  locale: Locale
  embedded?: boolean
  title: string
  stepCount: number
  wizardStep: number
  saving?: boolean
  onBack?: () => void
  children: ReactNode
  footer: ReactNode
}

export function ChannelWizardFrame({
  locale,
  embedded = false,
  title,
  stepCount,
  wizardStep,
  saving = false,
  onBack,
  children,
  footer,
}: ChannelWizardFrameProps) {
  if (embedded) {
    return (
      <div className="channel-wizard channel-wizard--embedded">
        <WizardStepBar total={stepCount} current={wizardStep} />
        <div className="channel-wizard-body channel-wizard-body--embedded">{children}</div>
        <footer className="channel-wizard-footer channel-wizard-footer--embedded">{footer}</footer>
      </div>
    )
  }

  return (
    <div className="channel-wizard-container">
      <header className="channel-wizard-header">
        <div className="channel-wizard-title" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onBack && (
            <button
              type="button"
              className="settings-btn settings-btn-icon"
              onClick={onBack}
              title={t(locale, '返回', 'Back')}
              disabled={saving}
              style={{ padding: '0.25rem 0.35rem', border: 'none', background: 'transparent' }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
                />
              </svg>
            </button>
          )}
          <div>
            <h4>{title}</h4>
          </div>
        </div>
      </header>

      <WizardStepBar total={stepCount} current={wizardStep} />
      <div className="channel-wizard-body">{children}</div>
      <footer className="channel-wizard-footer">{footer}</footer>
    </div>
  )
}
