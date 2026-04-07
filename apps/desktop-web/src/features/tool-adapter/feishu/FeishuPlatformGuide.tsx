import { t, type Locale } from '@shell/i18n/ui-locale'
import { desktopApi } from '@shell/integration/desktop-api'
import type { FeishuGuideState } from './model'

interface FeishuPlatformGuideProps {
  locale: Locale
  state: FeishuGuideState
  disabled: boolean
}

export function FeishuPlatformGuide({ locale, state, disabled }: FeishuPlatformGuideProps) {
  const handleOpenUrl = () => {
    void desktopApi.systemOpenUrl(state.platformUrl)
  }

  return (
    <aside className="feishu-guide-card">
      <div className="feishu-guide-eyebrow">{state.eyebrow}</div>
      <h5>{state.title}</h5>
      <p>{state.summary}</p>
      <div className="feishu-platform-url-card">
        <div className="feishu-platform-url-header">
          <strong>{state.platformLabel}</strong>
          <button
            type="button"
            className="settings-btn settings-btn-primary channel-wizard-open-btn"
            onClick={handleOpenUrl}
            disabled={disabled}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M9 2h5m0 0v5m0-5L7 9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t(locale, '打开平台', 'Open Platform')}
          </button>
        </div>
        <code>{state.platformUrl}</code>
        <p className="feishu-guide-note">{state.note}</p>
      </div>
      <ul className="feishu-guide-checklist">
        {state.checklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  )
}
