import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { ChannelManagerPane } from './ChannelManagerPane'
import './ChannelStudio.scss'

interface ChannelStudioProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  onClose: () => void
}

export function ChannelStudio({ open, locale, workspaceId, onClose }: ChannelStudioProps) {
  if (!open) {
    return null
  }

  return (
    <div
      className="channel-studio-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="channel-studio-shell"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="channel-studio-header">
          <div className="channel-studio-title-block">
            <div className="channel-studio-eyebrow">
              <AppIcon name="channels" className="vb-icon" aria-hidden="true" />
              <span>{t(locale, 'Channel Studio', 'Channel Studio')}</span>
            </div>
            <h2>{t(locale, '独立外部通道工作台', 'Standalone External Channel Workspace')}</h2>
          </div>
          <button
            type="button"
            className="channel-studio-close"
            onClick={onClose}
            aria-label={t(locale, '关闭通道工作台', 'Close channel studio')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <div className="channel-studio-body">
          <ChannelManagerPane locale={locale} workspaceId={workspaceId} variant="studio" />
        </div>
      </section>
    </div>
  )
}
