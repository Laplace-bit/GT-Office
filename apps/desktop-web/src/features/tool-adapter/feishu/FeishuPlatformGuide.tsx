import { t, type Locale } from '@shell/i18n/ui-locale'
import type { FeishuGuideState } from './model'

interface FeishuPlatformGuideProps {
  locale: Locale
  state: FeishuGuideState
  onCopyPlatformUrl: () => void
  copyingDisabled: boolean
}

export function FeishuPlatformGuide({
  locale,
  state,
  onCopyPlatformUrl,
  copyingDisabled,
}: FeishuPlatformGuideProps) {
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
            className="settings-btn settings-btn-secondary"
            onClick={onCopyPlatformUrl}
            disabled={copyingDisabled}
          >
            {t(locale, '复制地址', 'Copy URL')}
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
